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
                  103
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
                  100
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
                  103
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
                  100
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
                  114
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
                  100
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
                  103
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
                  110
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
                  103
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
                  100
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
                  114
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
                  101
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
                  103
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
                  114
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
                  101
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
    }
  ],
  "events": [
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
    }
  ],
  "types": [
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
            "name": "keepsakeCount",
            "type": "u64"
          },
          {
            "name": "playerCount",
            "type": "u64"
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
    }
  ]
};
