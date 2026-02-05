// Generate Mermaid diagrams from contract analysis

export function generateContractDiagram(
  classification: string,
  errorMessages: string[],
  builtins: Record<string, number>
): string {
  const errorText = errorMessages.join(' ').toLowerCase();
  
  switch (classification) {
    case 'NFT Marketplace':
      return generateNFTMarketplaceDiagram(errorMessages);
    case 'DEX/AMM':
      return generateDEXDiagram(errorMessages);
    case 'Lending Protocol':
      return generateLendingDiagram(errorMessages);
    case 'Staking/Governance':
      return generateStakingDiagram(errorMessages);
    default:
      return generateGenericDiagram(classification, errorMessages, builtins);
  }
}

function generateNFTMarketplaceDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Datum["📦 Datum (Listing)"]
        D1[seller: Address]
        D2[price: Int]
        D3[royalty_address: Address]
        D4[royalty_pct: Int]
        D5[fee_address: Address]
        D6[fee_pct: Int]
    end
    
    subgraph Redeemer["🎯 Redeemer"]
        R1[Buy]
        R2[Cancel]
    end
    
    subgraph Validation["✅ Validation Logic"]
        V1{Action?}
        V2[Check NFT sent to buyer]
        V3[Check seller paid]
        V4[Check fees paid]
        V5[Check royalties paid]
        V6[Check signed by seller]
    end
    
    subgraph Outputs["📤 Outputs"]
        O1[Buyer receives NFT]
        O2[Seller receives payment]
        O3[Platform receives fee]
        O4[Creator receives royalty]
    end
    
    R1 --> V1
    R2 --> V1
    V1 -->|Buy| V2
    V2 --> V3
    V3 --> V4
    V4 --> V5
    V5 --> O1 & O2 & O3 & O4
    
    V1 -->|Cancel| V6
    V6 -->|✓| O1
    
    style Datum fill:#1a1b26,stroke:#58a6ff
    style Redeemer fill:#1a1b26,stroke:#a371f7
    style Validation fill:#1a1b26,stroke:#3fb950
    style Outputs fill:#1a1b26,stroke:#d29922`;
}

function generateDEXDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Datum["📦 Datum (Pool State)"]
        D1[token_a: Asset]
        D2[token_b: Asset]
        D3[reserve_a: Int]
        D4[reserve_b: Int]
        D5[lp_token: Asset]
        D6[fee_num: Int]
    end
    
    subgraph Redeemer["🎯 Redeemer"]
        R1[Swap]
        R2[AddLiquidity]
        R3[RemoveLiquidity]
    end
    
    subgraph SwapLogic["🔄 Swap Validation"]
        S1[Calculate output amount]
        S2[Check min output met]
        S3[Check reserves updated]
        S4[Check fee taken]
    end
    
    subgraph LPLogic["💧 Liquidity Validation"]
        L1[Calculate LP tokens]
        L2[Check proportional deposit]
        L3[Mint/Burn LP tokens]
    end
    
    subgraph MEVRisk["⚠️ MEV Vectors"]
        M1[Front-running swaps]
        M2[Sandwich attacks]
        M3[Arbitrage]
    end
    
    R1 --> S1 --> S2 --> S3 --> S4
    R2 --> L1 --> L2 --> L3
    R3 --> L1
    
    S1 -.->|vulnerable| M1 & M2 & M3
    
    style Datum fill:#1a1b26,stroke:#58a6ff
    style Redeemer fill:#1a1b26,stroke:#a371f7
    style SwapLogic fill:#1a1b26,stroke:#3fb950
    style LPLogic fill:#1a1b26,stroke:#3fb950
    style MEVRisk fill:#1a1b26,stroke:#f85149`;
}

function generateLendingDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Datum["📦 Datum (Loan State)"]
        D1[borrower: Address]
        D2[collateral: Asset]
        D3[collateral_amount: Int]
        D4[borrowed: Asset]
        D5[borrowed_amount: Int]
        D6[interest_rate: Int]
        D7[oracle_ref: TxOutRef]
    end
    
    subgraph Redeemer["🎯 Redeemer"]
        R1[Borrow]
        R2[Repay]
        R3[Liquidate]
        R4[AddCollateral]
    end
    
    subgraph Validation["✅ Validation"]
        V1[Check collateral ratio]
        V2[Verify oracle price]
        V3[Calculate interest]
        V4[Check health factor]
    end
    
    subgraph MEVRisk["⚠️ MEV Vectors"]
        M1[Liquidation racing]
        M2[Oracle manipulation]
        M3[Interest arbitrage]
    end
    
    R1 --> V1 --> V2
    R2 --> V3
    R3 --> V4 --> V2
    
    V2 -.->|vulnerable| M2
    V4 -.->|vulnerable| M1
    
    style Datum fill:#1a1b26,stroke:#58a6ff
    style Redeemer fill:#1a1b26,stroke:#a371f7
    style Validation fill:#1a1b26,stroke:#3fb950
    style MEVRisk fill:#1a1b26,stroke:#f85149`;
}

function generateStakingDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Datum["📦 Datum (Stake State)"]
        D1[staker: Address]
        D2[stake_amount: Int]
        D3[stake_time: POSIXTime]
        D4[rewards_claimed: Int]
    end
    
    subgraph Redeemer["🎯 Redeemer"]
        R1[Stake]
        R2[Unstake]
        R3[ClaimRewards]
    end
    
    subgraph Validation["✅ Validation"]
        V1[Check stake duration]
        V2[Calculate rewards]
        V3[Verify signer]
    end
    
    R1 --> V3
    R2 --> V1 --> V3
    R3 --> V2 --> V3
    
    style Datum fill:#1a1b26,stroke:#58a6ff
    style Redeemer fill:#1a1b26,stroke:#a371f7
    style Validation fill:#1a1b26,stroke:#3fb950`;
}

function generateGenericDiagram(
  classification: string,
  errors: string[],
  builtins: Record<string, number>
): string {
  // Infer structure from builtins
  const hasListOps = builtins['headList'] || builtins['tailList'];
  const hasArithmetic = builtins['multiplyInteger'] || builtins['divideInteger'];
  const hasCrypto = builtins['verifyEd25519Signature'] || builtins['blake2b_256'];
  
  let validationSteps = [];
  if (hasListOps) validationSteps.push('V1[Iterate outputs/inputs]');
  if (hasArithmetic) validationSteps.push('V2[Calculate amounts]');
  if (hasCrypto) validationSteps.push('V3[Verify signatures]');
  if (validationSteps.length === 0) validationSteps.push('V1[Unknown validation]');
  
  const errorChecks = errors.slice(0, 4).map((e, i) => `E${i + 1}["${e.substring(0, 30)}..."]`);
  
  return `flowchart TB
    subgraph Datum["📦 Datum"]
        D1[field_1: unknown]
        D2[field_2: unknown]
        D3[field_n: unknown]
    end
    
    subgraph Redeemer["🎯 Redeemer"]
        R1[Action_1]
        R2[Action_2]
    end
    
    subgraph Validation["✅ Validation (${Object.keys(builtins).length} builtins)"]
        ${validationSteps.join('\n        ')}
    end
    
    ${errorChecks.length > 0 ? `subgraph Errors["⚠️ Error Conditions"]
        ${errorChecks.join('\n        ')}
    end` : ''}
    
    R1 --> ${validationSteps[0]?.split('[')[0] || 'V1'}
    R2 --> ${validationSteps[0]?.split('[')[0] || 'V1'}
    
    style Datum fill:#1a1b26,stroke:#58a6ff
    style Redeemer fill:#1a1b26,stroke:#a371f7
    style Validation fill:#1a1b26,stroke:#3fb950`;
}

export function generateDataStructureDiagram(
  classification: string,
  errors: string[]
): string {
  switch (classification) {
    case 'NFT Marketplace':
      return `classDiagram
    class Datum {
        +Address seller
        +Int price
        +Address royalty_address
        +Int royalty_percent
        +Address fee_address
        +Int fee_percent
    }
    
    class Redeemer {
        <<enumeration>>
        Buy
        Cancel
    }
    
    class ScriptContext {
        +Transaction tx
        +ScriptPurpose purpose
    }
    
    class Transaction {
        +List~TxIn~ inputs
        +List~TxOut~ outputs
        +Value mint
        +List~PubKeyHash~ signatories
    }
    
    Datum --> Redeemer : validated by
    ScriptContext --> Transaction : contains`;
    
    case 'DEX/AMM':
      return `classDiagram
    class PoolDatum {
        +AssetClass token_a
        +AssetClass token_b
        +Int reserve_a
        +Int reserve_b
        +AssetClass lp_token
        +Int fee_numerator
        +Int fee_denominator
    }
    
    class SwapRedeemer {
        +AssetClass offer
        +Int offer_amount
        +Int min_receive
    }
    
    class LiquidityRedeemer {
        +Int amount_a
        +Int amount_b
    }
    
    class Redeemer {
        <<enumeration>>
        Swap(SwapRedeemer)
        AddLiquidity(LiquidityRedeemer)
        RemoveLiquidity(LiquidityRedeemer)
    }
    
    PoolDatum --> Redeemer : validated by
    SwapRedeemer --> Redeemer
    LiquidityRedeemer --> Redeemer`;
    
    default:
      return `classDiagram
    class Datum {
        +field_1 unknown
        +field_2 unknown
    }
    
    class Redeemer {
        <<enumeration>>
        Action1
        Action2
    }
    
    Datum --> Redeemer : validated by`;
  }
}
