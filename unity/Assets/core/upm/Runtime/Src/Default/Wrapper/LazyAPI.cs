using UnityEngine;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Diagnostics;

namespace Puerts 
{
    public class LazyAPINative
    {
    }

    public static class LazyAPI
    {
        private readonly static HashSet<int> enabledJsEnvs = new HashSet<int>();
        private readonly static Dictionary<int, List<JSFunctionCallback>> callbacksE = new Dictionary<int, List<JSFunctionCallback>>();
        private readonly static Stopwatch sw = new Stopwatch();

        public static bool IsReflectionAPIEnabled(this JsEnv e) {
            return enabledJsEnvs.Contains(e.Index);
        }

        public static void RegisterLazyAPI(JsEnv jsEnv) 
        {
            bool isFirst = false;
            var typeId = jsEnv.TypeRegister.GetTypeId(jsEnv.isolate, typeof(LazyAPINative), out isFirst);
            if (isFirst)
            {
                PuertsDLL.RegisterFunction(jsEnv.isolate, typeId, "RegisterAPI", true, RegisterAPI, jsEnv.Idx);
                PuertsDLL.RegisterFunction(jsEnv.isolate, typeId, "ClearAllAPI", true, ClearAllAPI, jsEnv.Idx);
                PuertsDLL.RegisterFunction(jsEnv.isolate, typeId, "SetEnabled", true, SetEnabled, jsEnv.Idx);

                jsEnv.OnDispose += () =>
                {
                    enabledJsEnvs.Remove(jsEnv.Index);
                    callbacksE.Remove(jsEnv.Index);
                };
            }
        }

        [MonoPInvokeCallback(typeof(V8FunctionCallback))]
        private static void SetEnabled(IntPtr isolate, IntPtr info, IntPtr self, int paramLen, long data)
        {
            try 
            {
                int jsEnvIdx = (int)data;
                if (paramLen < 1)
                {
                    throw new Exception("invalid arguments length");
                }
                var csTypeJSValue = PuertsDLL.GetArgumentValue(isolate, info, 0);
                if (PuertsDLL.GetJsValueType(isolate, csTypeJSValue, false) != JsValueType.Boolean)
                {
                    throw new Exception("arg1 type should be boolean");
                }
                var e = PuertsDLL.GetBooleanFromValue(isolate, csTypeJSValue, false);
                if (e) {
                    enabledJsEnvs.Add(jsEnvIdx);
                } else {
                    enabledJsEnvs.Remove(jsEnvIdx);
                }
            }
            catch (Exception e)
            {
                PuertsDLL.ThrowException(isolate, "SetEnabled c# exception:" + e.Message + ",stack:" + e.StackTrace);
            }
		}

        [MonoPInvokeCallback(typeof(V8FunctionCallback))]
        private static void ClearAllAPI(IntPtr isolate, IntPtr info, IntPtr self, int paramLen, long data)
        {
            try
            {
                int jsEnvIdx = (int)data;
                callbacksE.Remove(jsEnvIdx);
            }
            catch (Exception e)
            {
                PuertsDLL.ThrowException(isolate, "ClearAllAPI c# exception:" + e.Message + ",stack:" + e.StackTrace);
            }
        }

        [MonoPInvokeCallback(typeof(V8FunctionCallback))]
        private static void Invoke(this LazyFieldWrap thiz, IntPtr isolate, IntPtr info, IntPtr self, int argumentsLen)
        {
            try
            {
                if (argumentsLen == 1)
                {
                    thiz.InvokeSetter(isolate, info, self, argumentsLen);
                }
                else
                {
                    thiz.InvokeGetter(isolate, info, self, argumentsLen);
                }
            }
            catch (Exception e)
            {
                PuertsDLL.ThrowException(isolate, "LazyFieldWrap.Invoke c# exception:" + e.Message + ",stack:" + e.StackTrace);
            }
        }

        [MonoPInvokeCallback(typeof(V8FunctionCallback))]
        private static void RegisterAPI(IntPtr isolate, IntPtr info, IntPtr self, int paramLen, long data)
        {
            try
            {
                int jsEnvIdx = (int)data;
                JsEnv jsEnv = JsEnv.jsEnvs[jsEnvIdx];
                var type = jsEnv.GeneralGetterManager.GetSelf(jsEnvIdx, PuertsDLL.GetObjectFromValue(isolate, PuertsDLL.GetArgumentValue(isolate, info, 0), false)) as Type;
                var apiName = PuertsDLL.GetStringFromValue(isolate, PuertsDLL.GetArgumentValue(isolate, info, 1), false);
                var memberTypesRef = PuertsDLL.GetArgumentValue(isolate, info, 2);
                var memberTypes = (MemberTypes)PuertsDLL.GetNumberFromValue(isolate, memberTypesRef, true);
                var flags = (BindingFlags)PuertsDLL.GetNumberFromValue(isolate, PuertsDLL.GetArgumentValue(isolate, info, 3), false);
                // var typeId = jsEnv.TypeRegister.GetTypeId(isolate, targetType);
                var members = type.GetMember(apiName, memberTypes, flags);
                PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)0);
                if (members.Length <= 0)
                {
                    PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)0);
                    PuertsDLL.ReturnNull(jsEnv.isolate, info);
                    return;
                }
                if (members[0] is FieldInfo)
                {
                    PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)MemberTypes.Field);
                    var fieldInfo = members[0] as FieldInfo;
                    if (fieldInfo.IsStatic && (fieldInfo.IsInitOnly || fieldInfo.IsLiteral))
                    {
                        PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)MemberTypes.Field | 256 /*StaticConst = 256 defined in lazy_api.ts*/);
                        var val = fieldInfo.GetValue(type);
                        var translateFunc = jsEnv.GeneralSetterManager.GetTranslateFunc(fieldInfo.FieldType);
                        translateFunc(jsEnv.Idx, isolate, NativeValueApi.SetValueToResult, info, val);
                        return;
                    }
                    var wrap = new LazyFieldWrap(apiName, jsEnv, type);
                    PuertsDLL.ReturnCSharpFunctionCallback(jsEnv.isolate, info, JsEnvCallbackWrapExt, AddCallbackExt(wrap.Invoke, jsEnvIdx));
                } else if (members[0] is PropertyInfo) {
                    PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)MemberTypes.Property);
                    var propInfo = members[0] as PropertyInfo;
                    var accessNonPublic = (flags & BindingFlags.NonPublic) != 0;
                    var overloads = new List<OverloadReflectionWrap>();
                    if (propInfo.CanRead)
                    {
                        overloads.Add(new OverloadReflectionWrap(propInfo.GetGetMethod(accessNonPublic), jsEnv));
                    }
                    else
                    {
                        Func<object> func = () => { return null; };
                        overloads.Add(new OverloadReflectionWrap(func.GetMethodInfo(), jsEnv));
                    }
                    if (propInfo.CanWrite) {
                        overloads.Add(new OverloadReflectionWrap(propInfo.GetSetMethod(accessNonPublic), jsEnv));
                    }
                    var wrap = new MethodReflectionWrap(apiName, overloads);
                    PuertsDLL.ReturnCSharpFunctionCallback(jsEnv.isolate, info, JsEnvCallbackWrapExt, AddCallbackExt(wrap.Invoke, jsEnvIdx));
                } else if (members[0] is MethodInfo) {
                    PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)MemberTypes.Method);
                    members = type.GetMember(apiName, MemberTypes.Method, flags ^ BindingFlags.DeclaredOnly); // ^ BindingFlags.DeclaredOnly to include override methods
                    var overloads = members.Select(x => x as MethodInfo).Select(m => new OverloadReflectionWrap(m, jsEnv, false)).ToList();
                    var wrap = new MethodReflectionWrap(apiName, overloads);
                    PuertsDLL.ReturnCSharpFunctionCallback(jsEnv.isolate, info, JsEnvCallbackWrapExt, AddCallbackExt(wrap.Invoke, jsEnvIdx));
                } else if (members[0] is Type) {
                    PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, (int)MemberTypes.NestedType);
                    Puerts.ResultHelper.Set(jsEnvIdx, isolate, info, members[0] as Type);
                }
            }
            catch (Exception e)
            {
                PuertsDLL.ThrowException(isolate, "RegisterAPI c# exception:" + e.Message + ",stack:" + e.StackTrace);
            }
        }

        private static long AddCallbackExt(JSFunctionCallback callback, int envIdx)
        {
            // prepare enough callbacksArr for envIdx
            List<JSFunctionCallback> callbacks;
            if (!callbacksE.TryGetValue(envIdx, out callbacks))
            {
                callbacks = new List<JSFunctionCallback>();
                callbacksE[envIdx] = callbacks;
            }
            // add callback to callbacks
            int callbackIdx = callbacks.Count;
            callbacks.Add(callback);
            var data = Utils.TwoIntToLong(envIdx, callbackIdx);
            return data;
        }
        [MonoPInvokeCallback(typeof(V8FunctionCallback))]
        private static void JsEnvCallbackWrapExt(IntPtr isolate, IntPtr info, IntPtr self, int paramLen, long data)
        {
            try
            {
                int envIdx, callbackIdx;
                Utils.LongToTwoInt(data, out envIdx, out callbackIdx);
                callbacksE[envIdx][callbackIdx](isolate, info, self, paramLen);
            }
            catch (Exception e)
            {
                PuertsDLL.ThrowException(isolate, "JsEnvCallbackWrapExt c# exception:" + e.Message + ",stack:" + e.StackTrace);
            }
        }
    }
}
