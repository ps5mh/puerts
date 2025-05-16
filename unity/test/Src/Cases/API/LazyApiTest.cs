using NUnit.Framework;
using System;
using Puerts;

namespace Puerts.UnitTest
{
    [TestFixture]
    public class LazyApiTest
    {
        [Test]
        public void LazyApiTestEnable()
        {
            var jsEnv = UnitTestEnv.GetEnv();
            Puerts.LazyAPI.RegisterLazyAPI(jsEnv);
            jsEnv.ExecuteModule("puerts/lazy_api.mjs");
            var ok = jsEnv.Eval<bool>(@"
puerts.LazyAPI.SetEnabled(true, true);
console.log(CS.UnityEngine.Application.isPlaying);
const appProps = Object.getOwnPropertyNames(CS.UnityEngine.Application);
console.log(appProps);

puerts.LazyAPI.SetEnabled(false);
console.log(CS.UnityEngine.Screen.dpi);
const screenProps = Object.getOwnPropertyNames(CS.UnityEngine.Screen);
console.log(screenProps);

!appProps.includes('dataPath') && screenProps.includes('width');
            ");
            Assert.True(ok);
            jsEnv.Tick();
        }
    }
}