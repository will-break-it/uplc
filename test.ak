let f = fn(rec) { fn(x) { rec(rec)(x) } }; f(f)(42)
