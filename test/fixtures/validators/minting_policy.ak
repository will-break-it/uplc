/// Simple minting policy
/// Tests: minting policy detection (2 params vs 3)
validator simple_mint {
  mint(_redeemer: Data, _policy_id: Data, _tx: Data) {
    True
  }

  else(_) {
    fail
  }
}
