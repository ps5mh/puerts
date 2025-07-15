using NUnit.Framework;
using System;
using Puerts;
using UnityEngine;

namespace Puerts.UnitTest
{
    public class Singleton<T> where T : new()
    {
        public int j = 4;
        public static T Instance { get; } = new T();
    }

    public static class UObjectExtension
    {
        public static int ExtTest(this UnityEngine.Object obj)
        {
            UnityEngine.Debug.Log($"ExtTest called with {obj.name}");
            return 3;
        }
    }

    public class LazyApiTestStaticInherit
    {
        public static LazyApiTest Instance
        {
            get
            {
                return LazyApiTest.Instance;
            }
        }
    }

    [TestFixture]
    public class LazyApiTest : Singleton<LazyApiTest>
    {
        public int i = 3;
        [Test]
        public void LazyApiTestEnable()
        {
            var jsEnv = new JsEnv();
            Puerts.LazyAPI.RegisterLazyAPI(jsEnv);
            jsEnv.ExecuteModule("puerts/lazy_api.mjs");
            jsEnv.Eval<bool>(@"puerts.LazyAPI.SetEnabled(true);");
            var ok = jsEnv.Eval<bool>(@"
puerts.LazyAPI.SetEnabled(true, true);
console.log(CS.UnityEngine.Application.isPlaying);
const appProps = Object.getOwnPropertyNames(CS.UnityEngine.Application);
console.log(appProps);

puerts.LazyAPI.SetEnabled(false);
console.log(CS.UnityEngine.Screen.dpi);
const screenProps = Object.getOwnPropertyNames(CS.UnityEngine.Screen);
console.log(screenProps);
puerts.LazyAPI.SetEnabled(true, true);
!appProps.includes('dataPath') && screenProps.includes('width');
        ");
            Assert.True(ok);
            jsEnv.Tick();
        }

        [Test]
        public void LazyApiTestGeneric()
        {
            var jsEnv = new JsEnv();
            Puerts.LazyAPI.RegisterLazyAPI(jsEnv);
            jsEnv.ExecuteModule("puerts/lazy_api.mjs");
            jsEnv.Eval<bool>(@"puerts.LazyAPI.SetEnabled(true, true);");
            var i = jsEnv.Eval<int>(@"
                var i = CS.Puerts.UnitTest.LazyApiTest.Instance.i;
                var List$Int32 = puerts.$generic(CS.System.Collections.Generic.List$1, CS.System.Int32)
                var a = new List$Int32();
                a.Add(3);
                i + a.get_Item(0);
            ");
            Assert.AreEqual(i, 6);
            jsEnv.Tick();
        }

        [Test]
        public void LazyApiTestStaticInherit()
        {
            var jsEnv = new JsEnv();
            Puerts.LazyAPI.RegisterLazyAPI(jsEnv);
            jsEnv.ExecuteModule("puerts/lazy_api.mjs");
            jsEnv.Eval<bool>(@"puerts.LazyAPI.SetEnabled(true, true);");
            var i = jsEnv.Eval<int>(@"
                CS.Puerts.UnitTest.LazyApiTestStaticInherit.Instance.j;
            ");
            Assert.AreEqual(i, 4);
            jsEnv.Tick();
        }

        [Test]
        public void LazyApiTestPerformance()
        {
            var jsEnv = new JsEnv();
            Puerts.LazyAPI.RegisterLazyAPI(jsEnv);
            jsEnv.ExecuteModule("puerts/lazy_api.mjs");
            jsEnv.Eval<bool>(@"puerts.LazyAPI.SetEnabled(true);");
            jsEnv.Eval<bool>(@"
var count = 10000;
var begin = Date.now();
var Application = CS.UnityEngine.Application;
for (let i = 0; i < count; i++) {
    var a = Application.isPlaying;
    delete Application.isPlaying;
}
console.log(`register api ${count} times:`, Date.now() - begin);
            ");

            jsEnv.Eval<bool>(@"
var count = 10000;
var begin = Date.now();
for (let i = 0; i < count; i++) {
    var a = Application.isPlaying;
}
console.log(`call static getter ${count} times:`, Date.now() - begin);
            ");
            jsEnv.Tick();
        }
    }
}