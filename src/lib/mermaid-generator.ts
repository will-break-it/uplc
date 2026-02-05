// Generate Mermaid diagrams from contract analysis

export function generateContractDiagram(
  classification: string,
  errorMessages: string[],
  builtins: Record<string, number>
): string {
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
    subgraph Input["Input"]
        I1[Script UTxO]
        I2[Buyer Wallet]
    end
    
    subgraph Datum["Datum"]
        D1[seller]
        D2[price]
        D3[royalty_address]
        D4[royalty_pct]
    end
    
    subgraph Redeemer["Redeemer"]
        R1[Buy]
        R2[Cancel]
    end
    
    subgraph Validation["Validation"]
        V1{Action?}
        V2[Verify NFT transfer]
        V3[Verify seller payment]
        V4[Verify fees]
        V5[Verify royalties]
        V6[Verify signature]
    end
    
    subgraph Output["Output"]
        O1[NFT → Buyer]
        O2[ADA → Seller]
        O3[Fee → Platform]
        O4[Royalty → Creator]
    end
    
    I1 --> Datum
    I2 --> Redeemer
    Datum --> V1
    Redeemer --> V1
    
    V1 -->|Buy| V2
    V2 --> V3 --> V4 --> V5
    V5 --> O1 & O2 & O3 & O4
    
    V1 -->|Cancel| V6
    V6 --> O1`;
}

function generateDEXDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Input["Input"]
        I1[Pool UTxO]
        I2[User Order]
    end
    
    subgraph PoolDatum["Pool Datum"]
        D1[token_a]
        D2[token_b]
        D3[reserve_a]
        D4[reserve_b]
        D5[lp_token]
    end
    
    subgraph Redeemer["Redeemer"]
        R1[Swap]
        R2[AddLiquidity]
        R3[RemoveLiquidity]
    end
    
    subgraph Validation["Validation"]
        V1{Action?}
        V2[Calculate output]
        V3[Check min received]
        V4[Update reserves]
        V5[Calculate LP tokens]
        V6[Verify proportions]
    end
    
    subgraph Output["Output"]
        O1[Updated Pool]
        O2[Tokens → User]
        O3[LP Tokens]
    end
    
    I1 --> PoolDatum
    I2 --> Redeemer
    PoolDatum --> V1
    Redeemer --> V1
    
    V1 -->|Swap| V2 --> V3 --> V4 --> O1 & O2
    V1 -->|AddLiquidity| V5 --> V6 --> O1 & O3
    V1 -->|RemoveLiquidity| V5 --> O1 & O2`;
}

function generateLendingDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Input["Input"]
        I1[Pool UTxO]
        I2[User Collateral]
    end
    
    subgraph LoanDatum["Loan Datum"]
        D1[borrower]
        D2[collateral]
        D3[borrowed_amount]
        D4[interest_rate]
    end
    
    subgraph Redeemer["Redeemer"]
        R1[Borrow]
        R2[Repay]
        R3[Liquidate]
    end
    
    subgraph Validation["Validation"]
        V1{Action?}
        V2[Check collateral ratio]
        V3[Calculate interest]
        V4[Check health factor]
        V5[Verify repayment]
    end
    
    subgraph Output["Output"]
        O1[Updated Loan]
        O2[Tokens → User]
        O3[Collateral released]
    end
    
    I1 --> LoanDatum
    I2 --> Redeemer
    LoanDatum --> V1
    Redeemer --> V1
    
    V1 -->|Borrow| V2 --> O1 & O2
    V1 -->|Repay| V3 --> V5 --> O1 & O3
    V1 -->|Liquidate| V4 --> O1 & O2`;
}

function generateStakingDiagram(errors: string[]): string {
  return `flowchart TB
    subgraph Input["Input"]
        I1[Stake Pool]
        I2[User Wallet]
    end
    
    subgraph StakeDatum["Stake Datum"]
        D1[staker]
        D2[amount]
        D3[stake_time]
        D4[rewards]
    end
    
    subgraph Redeemer["Redeemer"]
        R1[Stake]
        R2[Unstake]
        R3[ClaimRewards]
    end
    
    subgraph Validation["Validation"]
        V1{Action?}
        V2[Record stake]
        V3[Check duration]
        V4[Calculate rewards]
        V5[Verify owner]
    end
    
    subgraph Output["Output"]
        O1[Updated Stake]
        O2[Tokens → User]
        O3[Rewards → User]
    end
    
    I1 --> StakeDatum
    I2 --> Redeemer
    StakeDatum --> V1
    Redeemer --> V1
    
    V1 -->|Stake| V2 --> V5 --> O1
    V1 -->|Unstake| V3 --> V5 --> O1 & O2
    V1 -->|ClaimRewards| V4 --> V5 --> O1 & O3`;
}

function generateGenericDiagram(
  classification: string,
  errors: string[],
  builtins: Record<string, number>
): string {
  const hasListOps = builtins['headList'] || builtins['tailList'];
  const hasArithmetic = builtins['multiplyInteger'] || builtins['divideInteger'];
  
  return `flowchart TB
    subgraph Input["Input"]
        I1[Script UTxO]
        I2[Transaction]
    end
    
    subgraph Datum["Datum"]
        D1[field_1]
        D2[field_2]
        D3[field_n]
    end
    
    subgraph Redeemer["Redeemer"]
        R1[Action_1]
        R2[Action_2]
    end
    
    subgraph Validation["Validation"]
        V1{Check action}
        ${hasListOps ? 'V2[Process inputs/outputs]' : 'V2[Validate conditions]'}
        ${hasArithmetic ? 'V3[Calculate amounts]' : 'V3[Check constraints]'}
    end
    
    subgraph Output["Output"]
        O1[Updated UTxO]
        O2[User receives]
    end
    
    I1 --> Datum
    I2 --> Redeemer
    Datum --> V1
    Redeemer --> V1
    V1 --> V2 --> V3 --> O1 & O2`;
}

export function generateDataStructureDiagram(
  classification: string,
  errors: string[]
): string {
  switch (classification) {
    case 'NFT Marketplace':
      return `classDiagram
    class Datum {
        Address seller
        Int price
        Address royalty_address
        Int royalty_percent
        Address fee_address
        Int fee_percent
    }
    
    class Redeemer {
        <<enumeration>>
        Buy
        Cancel
    }
    
    class ScriptContext {
        Transaction tx
        ScriptPurpose purpose
    }
    
    Datum --> Redeemer : validated by
    ScriptContext --> Datum : contains`;
    
    case 'DEX/AMM':
      return `classDiagram
    class PoolDatum {
        AssetClass token_a
        AssetClass token_b
        Int reserve_a
        Int reserve_b
        AssetClass lp_token
        Int fee_num
    }
    
    class SwapRedeemer {
        AssetClass offer
        Int amount
        Int min_receive
    }
    
    class LiquidityRedeemer {
        Int amount_a
        Int amount_b
    }
    
    class Redeemer {
        <<enumeration>>
        Swap
        AddLiquidity
        RemoveLiquidity
    }
    
    PoolDatum --> Redeemer : validated by`;
    
    case 'Lending Protocol':
      return `classDiagram
    class LoanDatum {
        Address borrower
        AssetClass collateral
        Int collateral_amount
        AssetClass borrowed
        Int borrowed_amount
        Int interest_rate
    }
    
    class Redeemer {
        <<enumeration>>
        Borrow
        Repay
        Liquidate
        AddCollateral
    }
    
    LoanDatum --> Redeemer : validated by`;
    
    default:
      return `classDiagram
    class Datum {
        field_1 Type
        field_2 Type
    }
    
    class Redeemer {
        <<enumeration>>
        Action1
        Action2
    }
    
    Datum --> Redeemer : validated by`;
  }
}
