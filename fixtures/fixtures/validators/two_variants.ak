/// Test 002: Two redeemer variants
/// Simple pattern matching

pub type Redeemer {
  Accept
  Reject
}

validator two_variants {
  spend(_datum: Option<Data>, redeemer: Redeemer, _output_ref: Data, _tx: Data) {
    when redeemer is {
      Accept -> True
      Reject -> False
    }
  }
}
