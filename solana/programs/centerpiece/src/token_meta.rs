// Helpers for Token-2022 mints that store their own metadata (MetadataPointer -> self).
// Metadata lives in the mint account and grows when fields change, so every write
// is preceded by topping the mint up to its new rent-exempt minimum.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, PodStateWithExtensions},
    pod::PodMint,
};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::{Field, TokenMetadata};
use anchor_spl::token_interface::{
    token_metadata_initialize, token_metadata_update_field, TokenMetadataInitialize,
    TokenMetadataUpdateField,
};

/// Bytes the metadata TLV entry will take once name/symbol/uri and `fields` are written.
pub fn metadata_tlv_len(name: &str, symbol: &str, uri: &str, fields: &[(&str, String)]) -> Result<usize> {
    let meta = TokenMetadata {
        name: name.to_string(),
        symbol: symbol.to_string(),
        uri: uri.to_string(),
        additional_metadata: fields.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ..Default::default()
    };
    Ok(meta.tlv_size_of()?)
}

/// Moves lamports from `payer` so `account` is rent exempt at `len` bytes.
pub fn fund_to_len<'info>(
    payer: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    len: usize,
) -> Result<()> {
    let required = Rent::get()?.minimum_balance(len);
    let current = account.lamports();
    if required > current {
        transfer(
            CpiContext::new(
                anchor_lang::system_program::ID,
                Transfer { from: payer.clone(), to: account.clone() },
            ),
            required - current,
        )?;
    }
    Ok(())
}

pub struct MetaAccounts<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    /// PDA that is both mint authority and metadata update authority.
    pub authority: &'a AccountInfo<'info>,
    pub signer_seeds: &'a [&'a [&'a [u8]]],
}

/// Initializes metadata and custom fields in one go. The mint must already hold
/// lamports for the final size (see `metadata_tlv_len` / `fund_to_len`).
pub fn init_metadata(
    a: &MetaAccounts,
    name: &str,
    symbol: &str,
    uri: &str,
    fields: &[(&str, String)],
) -> Result<()> {
    token_metadata_initialize(
        CpiContext::new(
            a.token_program.key(),
            TokenMetadataInitialize {
                program_id: a.token_program.clone(),
                mint: a.mint.clone(),
                metadata: a.mint.clone(),
                mint_authority: a.authority.clone(),
                update_authority: a.authority.clone(),
            },
        )
        .with_signer(a.signer_seeds),
        name.to_string(),
        symbol.to_string(),
        uri.to_string(),
    )?;
    for (key, value) in fields {
        write_field(a, key, value.clone())?;
    }
    Ok(())
}

fn write_field(a: &MetaAccounts, key: &str, value: String) -> Result<()> {
    token_metadata_update_field(
        CpiContext::new(
            a.token_program.key(),
            TokenMetadataUpdateField {
                program_id: a.token_program.clone(),
                metadata: a.mint.clone(),
                update_authority: a.authority.clone(),
            },
        )
        .with_signer(a.signer_seeds),
        Field::Key(key.to_string()),
        value,
    )
}

/// Updates one custom field, first paying for any growth in the account.
pub fn update_field<'info>(
    a: &MetaAccounts<'_, 'info>,
    payer: &AccountInfo<'info>,
    key: &str,
    value: String,
) -> Result<()> {
    let new_len = {
        let data = a.mint.try_borrow_data()?;
        let state = PodStateWithExtensions::<PodMint>::unpack(&data)?;
        let mut meta = state.get_variable_len_extension::<TokenMetadata>()?;
        meta.update(Field::Key(key.to_string()), value.clone());
        state.try_get_new_account_len_for_variable_len_extension(&meta)?
    };
    fund_to_len(payer, a.mint, new_len)?;
    write_field(a, key, value)
}
