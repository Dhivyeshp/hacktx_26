/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/centerpiece.json`.
 */
export type Centerpiece = {
  "address": "DqqLyrxUPAiJ2m3Fu4uLL6GirTH2cSXXS9wJHmGngaZX",
  "metadata": {
    "name": "centerpiece",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Centerpiece game coin, soulbound player badges, keepsake NFTs and round attestations"
  },
  "instructions": [
    {
      "name": "attestRound",
      "discriminator": [
        116,
        193,
        34,
        119,
        118,
        248,
        97,
        248
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "docs": [
            "`init` fails if this round was already attested, so a round settles exactly once."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "arg",
                "path": "sessionId"
              },
              {
                "kind": "arg",
                "path": "roundNo"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "roundNo",
          "type": "u16"
        },
        {
          "name": "eventsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "playerCount",
          "type": "u8"
        }
      ]
    },
    {
      "name": "awardPlayer",
      "discriminator": [
        241,
        102,
        164,
        41,
        156,
        38,
        213,
        129
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round.sessionId",
                "account": "round"
              },
              {
                "kind": "account",
                "path": "round.roundNo",
                "account": "round"
              }
            ]
          }
        },
        {
          "name": "session",
          "docs": [
            "The round's session, when it has a table goal. Omit for sessions without one."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round.sessionId",
                "account": "round"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "award",
          "docs": [
            "One receipt per (round, wallet): a second award for the same round fails here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "walletCoinAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "points",
          "type": "u64"
        },
        {
          "name": "connections",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claimTableBonus",
      "discriminator": [
        197,
        129,
        156,
        243,
        39,
        114,
        122,
        59
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "session.sessionId",
                "account": "session"
              }
            ]
          }
        },
        {
          "name": "round",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round.sessionId",
                "account": "round"
              },
              {
                "kind": "account",
                "path": "round.roundNo",
                "account": "round"
              }
            ]
          }
        },
        {
          "name": "award",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "bonus",
          "docs": [
            "`init` makes the bonus claimable once per wallet per session."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  117,
                  115,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "session"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "walletCoinAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createItem",
      "discriminator": [
        176,
        125,
        142,
        227,
        8,
        231,
        222,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "item",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  116,
                  101,
                  109,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u16"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "supply",
          "type": "u32"
        },
        {
          "name": "minLevel",
          "type": "u8"
        },
        {
          "name": "kind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "fulfillReceipt",
      "discriminator": [
        34,
        193,
        30,
        176,
        25,
        238,
        73,
        51
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "receipt.wallet",
                "account": "receipt"
              },
              {
                "kind": "account",
                "path": "receipt.number",
                "account": "receipt"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "giveKudos",
      "discriminator": [
        156,
        44,
        19,
        78,
        72,
        169,
        185,
        20
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The game admin acting for a custodial player, or the sender signing for themselves. Pays rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "from"
        },
        {
          "name": "to"
        },
        {
          "name": "fromPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "from"
              }
            ]
          }
        },
        {
          "name": "toPlayer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "to"
              }
            ]
          }
        },
        {
          "name": "link",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  117,
                  100,
                  111,
                  115,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "from"
              },
              {
                "kind": "account",
                "path": "to"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "fromCoinAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "from"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "toCoinAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "to"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "fromBadge",
          "writable": true
        },
        {
          "name": "toBadge",
          "writable": true
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "grantAchievement",
      "discriminator": [
        64,
        166,
        124,
        234,
        236,
        39,
        3,
        205
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "wallet",
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bit",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "docs": [
            "The game coin. Only `mint_auth` can mint it, and only this program can sign as `mint_auth`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  105,
                  110,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        },
        {
          "name": "maxAwardPerRound",
          "type": "u64"
        },
        {
          "name": "maxKudos",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintKeepsake",
      "discriminator": [
        234,
        242,
        157,
        140,
        43,
        208,
        117,
        112
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  117,
                  110,
                  100,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "round.sessionId",
                "account": "round"
              },
              {
                "kind": "account",
                "path": "round.roundNo",
                "account": "round"
              }
            ]
          }
        },
        {
          "name": "wallet",
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "keepsakeMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  115,
                  97,
                  107,
                  101,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "config.keepsakeCount",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "keepsakeAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "keepsakeMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        },
        {
          "name": "image",
          "type": "string"
        },
        {
          "name": "challenge",
          "type": "string"
        }
      ]
    },
    {
      "name": "openSession",
      "discriminator": [
        130,
        54,
        124,
        7,
        236,
        20,
        104,
        104
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "arg",
                "path": "sessionId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "goal",
          "type": "u64"
        },
        {
          "name": "bonusPerPlayer",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeemItem",
      "discriminator": [
        237,
        232,
        119,
        199,
        26,
        197,
        2,
        13
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The game admin acting for a custodial player, or the wallet itself. Pays rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "wallet",
          "relations": [
            "player"
          ]
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "item",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  116,
                  101,
                  109,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "item.id",
                "account": "item"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "player.redemptions",
                "account": "player"
              }
            ]
          }
        },
        {
          "name": "coinMint",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "walletCoinAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "wallet"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "coinMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "relations": [
            "player"
          ]
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerPlayer",
      "discriminator": [
        242,
        146,
        194,
        234,
        234,
        145,
        228,
        42
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "wallet"
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "badgeMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  100,
                  103,
                  101,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "badgeAta",
          "writable": true
        },
        {
          "name": "mintAuth",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateItem",
      "discriminator": [
        28,
        222,
        44,
        175,
        216,
        228,
        171,
        184
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  95,
                  118,
                  50
                ]
              }
            ]
          }
        },
        {
          "name": "item",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  116,
                  101,
                  109,
                  95,
                  118,
                  50
                ]
              },
              {
                "kind": "account",
                "path": "item.id",
                "account": "item"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "supply",
          "type": "u32"
        },
        {
          "name": "minLevel",
          "type": "u8"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "award",
      "discriminator": [
        189,
        239,
        181,
        244,
        124,
        28,
        66,
        194
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "item",
      "discriminator": [
        92,
        157,
        163,
        130,
        72,
        254,
        86,
        216
      ]
    },
    {
      "name": "kudosLink",
      "discriminator": [
        47,
        40,
        98,
        76,
        19,
        251,
        81,
        91
      ]
    },
    {
      "name": "player",
      "discriminator": [
        205,
        222,
        112,
        7,
        165,
        155,
        206,
        218
      ]
    },
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    },
    {
      "name": "round",
      "discriminator": [
        87,
        127,
        165,
        51,
        73,
        78,
        116,
        174
      ]
    },
    {
      "name": "session",
      "discriminator": [
        243,
        81,
        72,
        115,
        214,
        188,
        72,
        144
      ]
    },
    {
      "name": "sessionBonus",
      "discriminator": [
        52,
        86,
        65,
        164,
        56,
        116,
        250,
        42
      ]
    }
  ],
  "events": [
    {
      "name": "achievementUnlocked",
      "discriminator": [
        125,
        160,
        118,
        30,
        180,
        209,
        171,
        62
      ]
    },
    {
      "name": "awarded",
      "discriminator": [
        255,
        24,
        226,
        21,
        157,
        74,
        108,
        62
      ]
    },
    {
      "name": "itemListed",
      "discriminator": [
        51,
        193,
        103,
        51,
        201,
        26,
        211,
        113
      ]
    },
    {
      "name": "itemRedeemed",
      "discriminator": [
        157,
        78,
        54,
        184,
        179,
        3,
        193,
        44
      ]
    },
    {
      "name": "keepsakeMinted",
      "discriminator": [
        6,
        123,
        119,
        157,
        170,
        137,
        174,
        250
      ]
    },
    {
      "name": "kudosGiven",
      "discriminator": [
        11,
        233,
        94,
        69,
        95,
        117,
        151,
        143
      ]
    },
    {
      "name": "playerRegistered",
      "discriminator": [
        175,
        78,
        252,
        170,
        75,
        230,
        36,
        251
      ]
    },
    {
      "name": "receiptFulfilled",
      "discriminator": [
        233,
        218,
        183,
        192,
        156,
        80,
        118,
        161
      ]
    },
    {
      "name": "roundAttested",
      "discriminator": [
        175,
        35,
        51,
        16,
        183,
        239,
        186,
        42
      ]
    },
    {
      "name": "sessionOpened",
      "discriminator": [
        34,
        79,
        77,
        95,
        195,
        207,
        104,
        223
      ]
    },
    {
      "name": "tableBonusClaimed",
      "discriminator": [
        210,
        115,
        173,
        100,
        201,
        218,
        74,
        98
      ]
    },
    {
      "name": "tableGoalReached",
      "discriminator": [
        122,
        57,
        213,
        198,
        226,
        207,
        181,
        177
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "awardTooLarge",
      "msg": "Award exceeds the per-round cap"
    },
    {
      "code": 6001,
      "name": "roundFullyAwarded",
      "msg": "Every player attested for this round has already been paid"
    },
    {
      "code": 6002,
      "name": "emptyRound",
      "msg": "A round must have at least one player"
    },
    {
      "code": 6003,
      "name": "stringTooLong",
      "msg": "String is too long"
    },
    {
      "code": 6004,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "Signer must be the game admin or the wallet itself"
    },
    {
      "code": 6006,
      "name": "selfKudos",
      "msg": "You can't send kudos to yourself"
    },
    {
      "code": 6007,
      "name": "kudosTooLarge",
      "msg": "Kudos must be between 1 and the configured maximum"
    },
    {
      "code": 6008,
      "name": "kudosCooldown",
      "msg": "Wait a minute before sending this person kudos again"
    },
    {
      "code": 6009,
      "name": "itemInactive",
      "msg": "This item isn't for sale right now"
    },
    {
      "code": 6010,
      "name": "soldOut",
      "msg": "This item is sold out"
    },
    {
      "code": 6011,
      "name": "levelTooLow",
      "msg": "Your level is too low for this item"
    },
    {
      "code": 6012,
      "name": "goalNotReached",
      "msg": "The table hasn't reached its goal yet"
    },
    {
      "code": 6013,
      "name": "notInSession",
      "msg": "This wallet wasn't paid in this session"
    },
    {
      "code": 6014,
      "name": "reservedAchievement",
      "msg": "Achievements below bit 16 are earned automatically, not granted"
    }
  ],
  "types": [
    {
      "name": "achievementUnlocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "unlocked",
            "docs": [
              "Bits unlocked by this transaction."
            ],
            "type": "u32"
          },
          {
            "name": "achievements",
            "docs": [
              "The player's full mask afterwards."
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "award",
      "docs": [
        "Receipt that a wallet was paid for a round. Its PDA can only be created once,",
        "which is what stops a round from paying the same player twice."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "points",
            "type": "u64"
          },
          {
            "name": "connections",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "awarded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "points",
            "type": "u64"
          },
          {
            "name": "xp",
            "type": "u64"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "leveledUp",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "The game server's authority key; the only signer allowed to settle rounds."
            ],
            "type": "pubkey"
          },
          {
            "name": "coinMint",
            "type": "pubkey"
          },
          {
            "name": "maxAwardPerRound",
            "type": "u64"
          },
          {
            "name": "maxKudos",
            "type": "u64"
          },
          {
            "name": "keepsakeCount",
            "type": "u64"
          },
          {
            "name": "playerCount",
            "type": "u64"
          },
          {
            "name": "itemCount",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mintAuthBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "item",
      "docs": [
        "A perk players can buy with TABLE. The game server fulfils it off chain."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "supply",
            "docs": [
              "0 = unlimited."
            ],
            "type": "u32"
          },
          {
            "name": "sold",
            "type": "u32"
          },
          {
            "name": "minLevel",
            "type": "u8"
          },
          {
            "name": "kind",
            "docs": [
              "Free-form category for the frontend/hub (e.g. 0 = table perk, 1 = robot action)."
            ],
            "type": "u8"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "itemListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "item",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u16"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "itemRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "item",
            "type": "pubkey"
          },
          {
            "name": "itemId",
            "type": "u16"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "number",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "keepsakeMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "pubkey"
          },
          {
            "name": "number",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "kudosGiven",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "firstTime",
            "type": "bool"
          },
          {
            "name": "kudosReceived",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "kudosLink",
      "docs": [
        "Kudos history for one (from, to) pair; also enforces the cooldown."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "count",
            "type": "u32"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "lastAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "player",
      "docs": [
        "One per wallet. Mirrors the numbers shown on the player's soulbound badge."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "badgeMint",
            "type": "pubkey"
          },
          {
            "name": "xp",
            "type": "u64"
          },
          {
            "name": "coinsEarned",
            "type": "u64"
          },
          {
            "name": "connections",
            "type": "u32"
          },
          {
            "name": "roundsPlayed",
            "type": "u32"
          },
          {
            "name": "kudosGiven",
            "type": "u32"
          },
          {
            "name": "kudosReceived",
            "type": "u32"
          },
          {
            "name": "achievements",
            "docs": [
              "Bitmask of ACH_* constants."
            ],
            "type": "u32"
          },
          {
            "name": "keepsakes",
            "type": "u16"
          },
          {
            "name": "redemptions",
            "type": "u16"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "playerRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "badgeMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "receipt",
      "docs": [
        "Proof of a redemption, numbered per player; `fulfilled` flips when the perk is delivered."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "item",
            "type": "pubkey"
          },
          {
            "name": "itemId",
            "type": "u16"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "number",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "fulfilled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "receiptFulfilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "itemId",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "round",
      "docs": [
        "Written once per round. `events_hash` is the sha256 of the round's off-chain",
        "event log, so payouts can be checked against the data that justified them."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "roundNo",
            "type": "u16"
          },
          {
            "name": "eventsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "playerCount",
            "type": "u8"
          },
          {
            "name": "awardedCount",
            "type": "u8"
          },
          {
            "name": "totalAwarded",
            "type": "u64"
          },
          {
            "name": "attestedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roundAttested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "roundNo",
            "type": "u16"
          },
          {
            "name": "eventsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "playerCount",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "session",
      "docs": [
        "A game night's shared table goal: every coin awarded in the session fills",
        "the pot, and once it reaches `goal` every player can claim the bonus."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "goal",
            "type": "u64"
          },
          {
            "name": "pot",
            "type": "u64"
          },
          {
            "name": "bonusPerPlayer",
            "type": "u64"
          },
          {
            "name": "reached",
            "type": "bool"
          },
          {
            "name": "reachedAt",
            "type": "i64"
          },
          {
            "name": "bonusesClaimed",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sessionBonus",
      "docs": [
        "Marks that a wallet has claimed a session's table-goal bonus."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sessionOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "goal",
            "type": "u64"
          },
          {
            "name": "bonusPerPlayer",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tableBonusClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tableGoalReached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "sessionId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "goal",
            "type": "u64"
          },
          {
            "name": "pot",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "achAppreciated",
      "type": "u32",
      "value": "64"
    },
    {
      "name": "achCollector",
      "type": "u32",
      "value": "128"
    },
    {
      "name": "achFirstConnection",
      "type": "u32",
      "value": "2"
    },
    {
      "name": "achFirstRound",
      "type": "u32",
      "value": "1"
    },
    {
      "name": "achGenerous",
      "type": "u32",
      "value": "32"
    },
    {
      "name": "achLevel3",
      "type": "u32",
      "value": "8"
    },
    {
      "name": "achLevel5",
      "type": "u32",
      "value": "16"
    },
    {
      "name": "achShopper",
      "type": "u32",
      "value": "256"
    },
    {
      "name": "achSocialButterfly",
      "type": "u32",
      "value": "4"
    },
    {
      "name": "achTeamPlayer",
      "type": "u32",
      "value": "512"
    },
    {
      "name": "awardSeed",
      "type": "bytes",
      "value": "[97, 119, 97, 114, 100, 95, 118, 50]"
    },
    {
      "name": "badgeSeed",
      "type": "bytes",
      "value": "[98, 97, 100, 103, 101, 95, 118, 50]"
    },
    {
      "name": "bonusSeed",
      "type": "bytes",
      "value": "[98, 111, 110, 117, 115, 95, 118, 50]"
    },
    {
      "name": "coinSeed",
      "type": "bytes",
      "value": "[99, 111, 105, 110, 95, 118, 50]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103, 95, 118, 50]"
    },
    {
      "name": "firstGrantableAchievementBit",
      "type": "u8",
      "value": "16"
    },
    {
      "name": "itemSeed",
      "type": "bytes",
      "value": "[105, 116, 101, 109, 95, 118, 50]"
    },
    {
      "name": "keepsakeSeed",
      "type": "bytes",
      "value": "[107, 101, 101, 112, 115, 97, 107, 101, 95, 118, 50]"
    },
    {
      "name": "kudosCooldownSeconds",
      "docs": [
        "Minimum seconds between two kudos from the same sender to the same receiver."
      ],
      "type": "i64",
      "value": "60"
    },
    {
      "name": "kudosSeed",
      "type": "bytes",
      "value": "[107, 117, 100, 111, 115, 95, 118, 50]"
    },
    {
      "name": "mintAuthSeed",
      "type": "bytes",
      "value": "[109, 105, 110, 116, 95, 97, 117, 116, 104]"
    },
    {
      "name": "playerSeed",
      "type": "bytes",
      "value": "[112, 108, 97, 121, 101, 114, 95, 118, 50]"
    },
    {
      "name": "receiptSeed",
      "type": "bytes",
      "value": "[114, 101, 99, 101, 105, 112, 116, 95, 118, 50]"
    },
    {
      "name": "roundSeed",
      "type": "bytes",
      "value": "[114, 111, 117, 110, 100, 95, 118, 50]"
    },
    {
      "name": "sessionSeed",
      "type": "bytes",
      "value": "[115, 101, 115, 115, 105, 111, 110, 95, 118, 50]"
    }
  ]
};
