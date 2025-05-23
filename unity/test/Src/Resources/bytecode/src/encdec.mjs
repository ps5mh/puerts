const v = "hello";
let ab = __puer_utf8_encode__(v);
console.assert(v === __puer_utf8_decode__(ab))
