/// Test 003: Three redeemer variants with fields

pub type Redeemer {
  Cancel
  Claim { amount: Int }
  Update { new_value: Int }
}

validator three_variants {
  spend(_datum: Option<Data>, redeemer: Redeemer, _output_ref: Data, _tx: Data) {
    when redeemer is {
      Cancel -> True
      Claim { amount } -> amount > 0
      Update { new_value } -> new_value >= 0
    }
  }
}
