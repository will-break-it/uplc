use types.{Action, Increment, Decrement, Reset}

/// Multi-redeemer validator
/// Tests: redeemer variant detection
validator multi_redeemer {
  spend(_datum: Option<Data>, redeemer: Action, _own_ref: Data, _tx: Data) {
    when redeemer is {
      Increment -> True
      Decrement -> True
      Reset -> True
    }
  }
}
