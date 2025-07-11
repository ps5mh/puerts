using NUnit.Framework;
using System;
using System.Reflection;
using System.Threading;

namespace Puerts.UnitTest
{
    [TestFixture]
    public class ByteCodeTest {
        [Test]
        public void ESModuleByteCode()
        {
            var jsEnv = UnitTestEnv.GetEnv();
            jsEnv.ExecuteModule("bytecode/console_log_test");
            jsEnv.Tick();
        }

        [Test]
        public void ByteCodeUnhandledRejection()
        {
            var jsEnv = UnitTestEnv.GetEnv();
            jsEnv.ExecuteModule("bytecode/unhandled_rejection");
            jsEnv.Tick();
        }

        [Test]
        public void ESModuleExecuteCJSByteCode()
        {
            var jsEnv = UnitTestEnv.GetEnv();
            ThirdParty.CommonJS.InjectSupportForCJS(jsEnv);
            string str = jsEnv.ExecuteModule<string>("bytecode/a_mjs", "default");
            Assert.True(str == "hello world");
            jsEnv.Tick();
        }

        [Test]
        public void EncodeDecodeTest()
        {
            var jsEnv = UnitTestEnv.GetEnv();
            ThirdParty.CommonJS.InjectSupportForCJS(jsEnv);
            string str = jsEnv.ExecuteModule<string>("bytecode/src/encdec.mjs", "default");
            jsEnv.Tick();
        }
    }
}