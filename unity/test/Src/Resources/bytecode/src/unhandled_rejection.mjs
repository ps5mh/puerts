// crash
(async () => {
    this.b();
})();

// fine
// (async function() {
//     this.b();
// })();

// const a = {};
// (() => {
//     this.b();
// })();

// const a = {};
// (async function() {
//     a.b();
// })();