using UnityEngine;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Diagnostics;
using UnityEngine.Scripting;

#if PUERTS_DISABLE_IL2CPP_OPTIMIZATION || (!PUERTS_IL2CPP_OPTIMIZATION && UNITY_IPHONE) || !ENABLE_IL2CPP

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

        public static bool IsReflectionAPIEnabled(this JsEnv e)
        {
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
                if (e)
                {
                    enabledJsEnvs.Add(jsEnvIdx);
                }
                else
                {
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
                var memberTypes = (int)PuertsDLL.GetNumberFromValue(isolate, memberTypesRef, true);
                var flags = (BindingFlags)PuertsDLL.GetNumberFromValue(isolate, PuertsDLL.GetArgumentValue(isolate, info, 3), false);
                var obj = LazyAPIUtility.RegisterAPI_Impl(type, apiName, ref memberTypes, flags);
                PuertsDLL.SetNumberToOutValue(jsEnv.isolate, memberTypesRef, memberTypes);
                if ((memberTypes & (int)MemberTypes.Field) != 0)
                {
                    if ((memberTypes & (int)LazyAPIUtility.StaticConst) != 0)
                    {
                        Puerts.ResultHelper.Set(jsEnvIdx, isolate, info, obj);
                    }
                    else
                    {
                        var filedInfo = obj as FieldInfo;
                        var callbackID = AddCallbackExt(new LazyFieldWrap(filedInfo.Name, jsEnv, filedInfo.DeclaringType).Invoke, jsEnvIdx);
                        PuertsDLL.ReturnCSharpFunctionCallback(isolate, info, JsEnvCallbackWrapExt, callbackID);
                    }
                }
                else if ((memberTypes & (int)MemberTypes.Property) != 0 || (memberTypes & (int)MemberTypes.Method) != 0)
                {
                    var methodInfos = obj as MethodInfo[];
                    var callbackID = AddCallbackExt(new MethodReflectionWrap(methodInfos[0].Name, methodInfos.Select(m => new OverloadReflectionWrap(m, jsEnv, false)).ToList()).Invoke, jsEnvIdx);
                    PuertsDLL.ReturnCSharpFunctionCallback(isolate, info, JsEnvCallbackWrapExt, callbackID);
                }
                else
                {
                    Puerts.ResultHelper.Set(jsEnvIdx, isolate, info, obj);
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

#else

namespace Puerts
{
    public static class LazyAPI
    {
        [DllImport("__Internal", CallingConvention = CallingConvention.Cdecl)]
        public static extern void RegisterLazyApiImpl(IntPtr apis, IntPtr envRef);
        public static void RegisterLazyAPI(JsEnv e)
        {
            RegisterLazyApiImpl(e.apis, e.nativePesapiEnv);
        }
    }
}

#endif


namespace Puerts
{
    public static class LazyAPIUtility
    {
        public const MemberTypes StaticConst = (MemberTypes)256; /* MemberTypes.StaticConst defined in lazy_api.ts */
        public const MemberTypes SetterOnly = (MemberTypes)512; /* MemberTypes.SetterOnly defined in lazy_api.ts */
        public delegate object RegisterAPI_Delegate(Type type, string apiName, ref int memberTypes, BindingFlags flags);

        [Preserve]
        private static void __Preserve__()
        {
            Type t = typeof(Type);
            t.GetProperties(BindingFlags.Default);
            var _1 = t.IsGenericTypeDefinition;
            var _2 = t.IsGenericType;
            var _3 = t.GetGenericArguments();
            var _4 = t.GetNestedType("", BindingFlags.Default);
            var _5 = t.GetProperties(BindingFlags.Default);
            var _6 = t.IsEnum;
            var _7 = t.Name;
            var _8 = System.Enum.GetName(t, 0);
            var _9 = _5[0].Name;

        }

        [MonoPInvokeCallback(typeof(RegisterAPI_Delegate))]
        public static object RegisterAPI_Impl(Type type, string apiName, ref int memberTypes, BindingFlags flags)
        {
            var members = type.GetMember(apiName, (MemberTypes)memberTypes, flags);
            memberTypes = 0;
            if (members.Length <= 0)
            {
                return null;
            }
            if (members[0] is FieldInfo)
            {
                memberTypes = (int)MemberTypes.Field;
                var fieldInfo = members[0] as FieldInfo;
                if (fieldInfo.IsStatic && (fieldInfo.IsInitOnly || fieldInfo.IsLiteral))
                {
                    memberTypes = (int)(MemberTypes.Field | StaticConst);
                    var val = fieldInfo.GetValue(type);
                    return val;
                }
                return fieldInfo;
            }
            else if (members[0] is PropertyInfo)
            {
                var propInfo = members[0] as PropertyInfo;
                memberTypes = (int)MemberTypes.Property | (!propInfo.CanRead ? (int)SetterOnly : 0);
                var accessNonPublic = (flags & BindingFlags.NonPublic) != 0;
                var overloads = new List<MethodInfo>();
                if (propInfo.CanRead)
                {
                    overloads.Add(propInfo.GetGetMethod(accessNonPublic));
                }
                if (propInfo.CanWrite)
                {
                    overloads.Add(propInfo.GetSetMethod(accessNonPublic));
                }
                return overloads.ToArray();
            }
            else if (members[0] is MethodInfo)
            {
                memberTypes = (int)MemberTypes.Method;
                members = type.GetMember(apiName, MemberTypes.Method, flags ^ BindingFlags.DeclaredOnly); // ^ BindingFlags.DeclaredOnly to include override methods
                return members.Select(x => x as MethodInfo).Where(x => !x.IsGenericMethod).ToArray();
            }
            else if (members[0] is Type)
            {
                memberTypes = (int)MemberTypes.NestedType;
                return members[0];
            }
            return null;
        }
    }
}