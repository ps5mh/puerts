/**
 * Lazy API Utilities
 * @author bingcongni
 * @see https://iwiki.woa.com/p/4008334693
 */

import type CSharp from 'csharp';

const { puerts, CS, console: logger } = global;

const REGISTER_LAZY_API = function () {
    // #region native implementations
    const enum MemberTypes {
        Invalid = 0,
        Constructor = 1,
        Event = 2,
        Field = 4,
        Method = 8,
        Property = 16,
        TypeInfo = 32,
        Custom = 64,
        NestedType = 128,
        All = 191,
        StaticConst = 256, // defined and used by lazy_api
        SetterOnly = 512, // defined and used by lazy_api
    }

    const enum BindingFlags {
        Default = 0,
        IgnoreCase = 1,
        DeclaredOnly = 2,
        Instance = 4,
        Static = 8,
        Public = 16,
        NonPublic = 32,
        FlattenHierarchy = 64,
        InvokeMethod = 256,
        CreateInstance = 512,
        GetField = 1024,
        SetField = 2048,
        GetProperty = 4096,
        SetProperty = 8192,
        PutDispProperty = 16384,
        PutRefDispProperty = 32768,
        ExactBinding = 65536,
        SuppressChangeType = 131072,
        OptionalParamBinding = 262144,
        IgnoreReturn = 16777216,
    }

    // declear c# implemented APIs defined in DynamicBinder.cs
    const bridge = CS.Puerts.LazyAPINative;
    const CSIMPL = {
        /**
         * @returns fieldvalue, if memberType === (MemberTypes.Field | MemberTypes.StaticConst)
         *          type, if memberType === MemberTypes.NestedType
         *          funcion, if memberType === MemberTypes.Field || memberType === MemberTypes.Property || memberType === MemberTypes.Method
         *          null, if memberType === 0
         */
        RegisterAPI(csType: CSharp.System.Type, apiName: string, memberType: CSharp.$Ref<MemberTypes>, bindingFlags: BindingFlags) {
            return bridge.RegisterAPI(csType, apiName, memberType, bindingFlags);
        },
        ClearAllAPI: bridge.ClearAllAPI as () => void,
        SetEnabled: bridge.SetEnabled as (enabled: boolean) => void,
    };

    type JSClass = Function & {
        __static_inherit__?: true;
        __puertsMetadata: { classid: number; readonlyStaticMembers?: Set<string> };
        __p_isEnum?: true;
        __p_innerType?: CSharp.System.Type;
        __p_isUseLazyAPI?: true;
        __p_notFoundAPIList?: Map<string, boolean>;
        __p_extensionAPIList?: string[];
        [key: string]: unknown; // static fields
    };

    const PUERTS_JS_CLASS_INNER_FIELDS = new Set<string | symbol>([
        'name', // @see Function.name
        'length', // @see Function.length
        '__static_inherit__', // set by csharp.mjs.txt, to indicate this class has been imported by CSharp.xxxxx access
        '__puertsMetadata', // set by JSEngine.cpp, { classid: number, readonlyStaticMembers: Set<string> }
        '__p_isEnum', // set by puerts.TypeRegister::RegisterType, to indicate this class is an enum
        '__p_innerType', // set by puerts.TypeRegister::RegisterType, a property returns corresponding C# Type. __puerts.Array is a special case which does not contain this field
        '__p_isUseLazyAPI', // (added by lazy_api) set by puerts.TypeRegister::RegisterType, to indicate this class can be extended by lazy api feature
        '__p_notFoundAPIList', // (added by lazy_api) set by addAPIHierarchy, if not foud such api on this class and parents
        '__p_extensionAPIList', // (added by lazy_api) set by addExtensionAPI
    ]);
    // #endregion

    // #region log utilities
    const enum LL {
        I,
        D,
        W,
        E,
    }
    const LOG_FUNCS = {
        [LL.I]: logger.log,
        [LL.D]: logger.log,
        [LL.W]: logger.warn,
        [LL.E]: logger.error,
    };
    const getClassName = (jsClass: JSClass): string => jsClass.name?.split(',')[0] ?? "";
    function log(ll: LL, info: string): void;
    function log(ll: LL, info: string, jsClass: JSClass, apiName: string, isStatic: boolean): void;
    function log(ll: LL, info: string, jsClass?: JSClass, apiName?: string, isStatic?: boolean): void {
        if (ll < config.LL) return;
        let logstr = info;
        if (jsClass && apiName) {
            const className = getClassName(jsClass);
            logstr = `${className}::${apiName.toString()} ${isStatic ? 'static' : 'instance'} ${info}`;
        }
        LOG_FUNCS[ll](`[JS] [lazy_api] ${logstr}\n ${new Error().stack}`);
    }
    // #endregion

    function wrapAPI(
        csType: CSharp.System.Type,
        jsClass: JSClass,
        apiName: string,
        api: any,
        isStatic: boolean,
        csMemberType: MemberTypes,
        bflags: BindingFlags,
    ) {
        const addAPITarget = isStatic ? jsClass : jsClass.prototype;
        // const api = CSIMPL.RegisterAPI(csType, apiName, csMemberType, bflags);
        if (api === null || api === undefined) {
            LL.E >= config.LL && log(LL.E, 'RegisterAPI inner failed', jsClass, apiName, isStatic);
            return false;
        }
        if (csMemberType === (MemberTypes.Field | MemberTypes.StaticConst)) {
            Object.defineProperty(addAPITarget, apiName, {
                value: api,
                writable: false,
                configurable: true,
                enumerable: false,
            });
            LL.D >= config.LL && log(LL.D, 'getter register const api success', jsClass, apiName, isStatic);
            return true;
        }
        if (csMemberType === MemberTypes.NestedType && config.IS_INNER_CLASS_LAZY_ENABLED && isStatic) {
            // try access api as inner class
            const ok = addNestedType(csType, jsClass, apiName, api);
            return ok;
        }
        if (csMemberType & (MemberTypes.Field | MemberTypes.Property)) {
            Object.defineProperty(addAPITarget, apiName, {
                get: (csMemberType & MemberTypes.SetterOnly) ? undefined : api,
                set: api,
                configurable: true,
                enumerable: false,
            });
            LL.D >= config.LL && log(LL.D, 'getter/setter register api success', jsClass, apiName, isStatic);
            return true;
        }
        if (csMemberType === MemberTypes.Method) {
            const isExtensionMethod = !isStatic && (bflags & BindingFlags.Static);
            if (isExtensionMethod) {
                const extApi = function (this: unknown, ...args: any[]) {
                    return api.call(null, this, ...args);
                };
                Reflect.set(Object, apiName, extApi, addAPITarget);
                LL.D >= config.LL && log(LL.D, 'extension method register api success', jsClass, apiName, isStatic);
                return true;
            }
            if (config.SET_LAZY_API_NAME) {
                const apiNamed = eval(`(api) => {return function ${apiName}(...args){return api.call(this, ...args)}}`)(api);
                Reflect.set(Object, apiName, apiNamed, addAPITarget);
                LL.D >= config.LL && log(LL.D, 'method register api success', jsClass, apiName, isStatic);
                return true;
            }
            Reflect.set(Object, apiName, api, addAPITarget);
            LL.D >= config.LL && log(LL.D, 'method register api success', jsClass, apiName, isStatic);
            return true;
        }
        return false;
    }

    function addExtensionAPI(csType: CSharp.System.Type, jsClass: JSClass, apiName: string, extClses: JSClass[] | undefined) {
        if (!extClses) return false;
        LL.D >= config.LL && log(LL.D, 'check extension class', jsClass, apiName, false);
        const typesRef = puerts.$ref(MemberTypes.Method);
        const flags = BindingFlags.Public | BindingFlags.DeclaredOnly | BindingFlags.Static;
        let api;
        for (const extCls of extClses) {
            if (!extCls) continue;
            const tryExtType = puerts.$typeof(extCls);
            if (!tryExtType) continue;
            api = CSIMPL.RegisterAPI(tryExtType, apiName, typesRef, flags);
            if (puerts.$unref(typesRef) === MemberTypes.Method) {
                break;
            }
        }
        if (api === null || api === undefined) return false;
        const ok = wrapAPI(csType, jsClass, apiName, api, false, MemberTypes.Method, flags);
        if (ok) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
                if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_extensionAPIList')) {
                    const cls = jsClass;
                    cls.__p_extensionAPIList = [];
                }
                jsClass.__p_extensionAPIList!.push(apiName);
            }
            return true;
        }
        return false;
    }

    function addEnumAPI(csType: CSharp.System.Type, jsClass: JSClass, apiName: string) {
        if (!isNaN(+apiName)) {
            if (!csType) return false;
            const enumName = CS.System.Enum.GetName(csType, new CS.Puerts.Int32Value(+apiName));
            Object.defineProperty(jsClass, apiName, {
                value: enumName,
                writable: false,
                configurable: true,
                enumerable: false,
            });
            LL.D >= config.LL && log(LL.D, 'enum(int32 key) register api success', jsClass, apiName, true);
            return true;
        }
        const ok = addAPI(csType, jsClass, apiName, true, MemberTypes.Field);
        if (ok) {
            return true;
        }
        return false;
    }

    function addGenericAPI(jsClass: JSClass, apiName: string, isStatic: boolean) {
        const apiNameImpl = apiName.substring(1);
        const api = function (this: unknown, typeArg: JSClass[], ...args: any[]) {
            LL.D >= config.LL && log(LL.D, `call generic method: ${typeArg.length}`, jsClass, apiName, isStatic);
            const apiImpl = puerts.$genericMethod(jsClass, apiNameImpl, ...typeArg);
            return apiImpl.call(this, ...args);
        };
        Reflect.set(Object, apiName, api, isStatic ? jsClass : jsClass.prototype);
        LL.D >= config.LL && log(LL.D, 'generic method register api success', jsClass, apiName, isStatic);
        return true;
    }

    function addNestedType(csType: CSharp.System.Type, jsClass: JSClass, apiName: string, innerType?: any) {
        const flags = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public;
        innerType = innerType ?? csType.GetNestedType(apiName.replace('$', '`'), flags);
        if (innerType) {
            if (innerType.IsGenericTypeDefinition && csType.IsGenericType) {
                const genericArgs = csType.GetGenericArguments();
                const genericArgsJS: any[] = [];
                for (let i = 0; i < genericArgs.Length; i++) {
                    genericArgsJS.push(genericArgs.get_Item(i));
                }
                const api = puerts.$csTypeToClass(innerType.MakeGenericType(...genericArgsJS));
                Object.defineProperty(jsClass, apiName, { configurable: false, value: api, writable: false });
                LL.D >= config.LL && log(LL.D, 'NestedType register api success, inner class of generic class', jsClass, apiName, true);
                return true;
            }

            const api = puerts.$csTypeToClass(innerType);
            Object.defineProperty(jsClass, apiName, { configurable: false, value: api, writable: false });
            LL.D >= config.LL && log(LL.D, 'NestedType register api success', jsClass, apiName, true);
            return true;
        }
    }

    function addPrivateInterfaceProperty(csType: CSharp.System.Type, jsClass: JSClass, apiName: string) {
        const flagsNonPub = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
        const properties = csType.GetProperties(flagsNonPub);

        for (let i = 0; i < properties.Length; i++) {
            const prop = properties.get_Item(i);
            if (prop.Name.endsWith("." + apiName)) {
                const api = CSIMPL.RegisterAPI(csType, prop.Name, puerts.$ref(MemberTypes.Property), flagsNonPub);
                Object.defineProperty(jsClass.prototype, apiName, {
                    get: api,
                    set: api,
                    configurable: true,
                    enumerable: false,
                });
                LL.D >= config.LL && log(LL.D, 'getter/setter register api success(private)', jsClass, apiName, false);
                return true;
            }
        }
        return false;
    }

    function addAPI(
        csType: CSharp.System.Type,
        jsClass: JSClass,
        apiName: string,
        isStatic: boolean,
        filterMemberTypes: MemberTypes,
    ) {
        if (!csType) {
            LL.W >= config.LL && log(LL.W, 'bad state, csType is null', jsClass, apiName, isStatic);
            return false;
        }
        LL.D >= config.LL && log(LL.D, 'try api register', jsClass, apiName, isStatic);
        if (jsClass === CS.System.Object) {
            LL.D >= config.LL && log(LL.D, 'api register fail reach System.Object', jsClass, apiName, isStatic);
            return false;
        }
        if (
            Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList') &&
            jsClass.__p_notFoundAPIList!.get(apiName) === isStatic
        ) {
            LL.D >= config.LL && log(LL.D, 'api register fail __p_notFoundAPIList', jsClass, apiName, isStatic);
            return false;
        }
        if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
            if (!isStatic) {
                // try add as extension api, even if this class was not registered as __p_isUseLazyAPI
                const ok = addExtensionAPI(csType, jsClass, apiName, config.extensions.get(jsClass));
                if (ok) return ok;
            } else if (isStatic && config.IS_INNER_CLASS_LAZY_ENABLED) {
                // try add as inner class api when IS_INNER_CLASS_LAZY_ENABLED, even if this class was not registered as __p_isUseLazyAPI
                const ok = addNestedType(csType, jsClass, apiName);
                if (ok) return ok;
            }
            LL.D >= config.LL && log(LL.D, 'api register fail __p_isUseLazyAPI', jsClass, apiName, isStatic);
            return undefined;
        }
        LL.D >= config.LL && log(LL.D, 'begin api register', jsClass, apiName, isStatic);

        const bindingFlags =
            BindingFlags.Public | BindingFlags.DeclaredOnly
            | (isStatic ? BindingFlags.Static : BindingFlags.Instance)
            | BindingFlags.NonPublic; // to support IEnumerator.MoveNext
        const memberTypeRef = puerts.$ref(filterMemberTypes)
        const api = CSIMPL.RegisterAPI(csType, apiName, memberTypeRef, bindingFlags);
        const csMemberType = puerts.$unref(memberTypeRef)
        LL.D >= config.LL && log(LL.D, `get member type: ${csMemberType}`, jsClass, apiName, isStatic);
        if (csMemberType === MemberTypes.Invalid || api === null || api === undefined) {
            if (!isStatic) {
                let ok = addExtensionAPI(csType, jsClass, apiName, config.extensions.get(jsClass));
                if (ok) return ok;
            }
        } else {
            const ok = wrapAPI(csType, jsClass, apiName, api, isStatic, csMemberType, bindingFlags);
            if (ok) return ok;
        }
        // return undefined will search parent
        return undefined;
    }

    function addAPIHierarchy(
        csType: CSharp.System.Type,
        jsClass: JSClass,
        apiName: string | symbol,
        isStatic: boolean,
        filterMemberTypes: MemberTypes,
    ) {
        try {
            if (typeof apiName !== 'string') return false;
            if (
                Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList') &&
                jsClass.__p_notFoundAPIList!.get(apiName) === isStatic
            ) {
                LL.D >= config.LL && log(LL.D, 'api register fail __p_notFoundAPIList', jsClass, apiName, isStatic);
                return false;
            }
            let begin;
            if (config.LAZY_API_PROFILE_TIMER !== -1) begin = Date.now();
            if (config.IS_SIMPLIFIED_GENERIC_ENABLED && apiName.startsWith('$')) {
                const ok = addGenericAPI(jsClass, apiName, isStatic);
                ok && config.TO_CLEAR_API_JSCLASSES.add(jsClass);
                if (config.LAZY_API_PROFILE_TIMER !== -1) config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                return ok;
            }
            if (IS_LAZY_API_ENABLED) {
                if (isStatic && csType.IsEnum) {
                    const ok = addEnumAPI(csType, jsClass, apiName);
                    if (ok) {
                        config.TO_CLEAR_API_JSCLASSES.add(jsClass);
                        if (config.LAZY_API_PROFILE_TIMER !== -1) config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                        return ok;
                    }
                }
                let curClass = jsClass;
                let curType = csType;
                let level = 0;
                while (true) {
                    const ok = addAPI(curType, curClass, apiName, isStatic, filterMemberTypes);
                    if (ok === false) break;
                    else if (ok) {
                        if (level > 1) {
                            LL.W >= config.LL &&
                                log(LL.W, `slow addApi recursive level: ${level}`, jsClass, apiName, isStatic);
                        }
                        config.TO_CLEAR_API_JSCLASSES.add(curClass);
                        if (config.LAZY_API_PROFILE_TIMER !== -1) config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                        return ok;
                    } else if (ok === undefined) {
                        curClass = Object.getPrototypeOf(curClass);
                        curType = curType.BaseType;
                        LL.D >= config.LL && log(LL.D, `try parent: ${curClass.name} ${csType.Name}`, jsClass, apiName, isStatic);
                        level = level + 1;
                    }
                }
            }
            if (!isStatic) {
                // to support IEnumerator.Current
                const ok = addPrivateInterfaceProperty(csType, jsClass, apiName);
                if (ok) return ok;
            }
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList')) {
                const cls = jsClass;
                cls.__p_notFoundAPIList = new Map<string, boolean>();
            }
            jsClass.__p_notFoundAPIList!.set(apiName, isStatic);
            LL.W >= config.LL && log(LL.W, 'register api failed!', jsClass, apiName, isStatic);
            if (config.LAZY_API_PROFILE_TIMER !== -1) config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
        } catch (e) {
            LL.E >= config.LL && log(LL.E, `register api failed! With exception: ${e} ${e.stack}`, jsClass, apiName.toString(), isStatic);
        }
        return false;
    }

    function ensureStaticInherit(cls: any) {
        if (!cls.__static_inherit__) {
            LL.D >= config.LL && log(LL.D, 'ensureStaticInherit', cls, "", false);
            let currentCls = cls, parentPrototype = Object.getPrototypeOf(currentCls.prototype);

            // 此处parentPrototype如果是一个泛型，会丢失父父的继承信息，必须循环找下去
            while (parentPrototype) {
                Object.setPrototypeOf(currentCls, parentPrototype.constructor);//v8 api的inherit并不能把静态属性也继承，通过这种方式修复下
                currentCls.__static_inherit__ = true;

                currentCls = parentPrototype.constructor;
                parentPrototype = Object.getPrototypeOf(currentCls.prototype);
                if (currentCls === Object || currentCls === Function || currentCls.__static_inherit__) break;
            }
        }
    }

    function setupSystemObjectInstanceLazyProxy() {
        if (puerts.__instance_lazy_proxy__) return;
        const instanceProxyHandler: ProxyHandler<object> = {};
        instanceProxyHandler.get = function (t, p, r) {
            if (p === 'prototype') {
                return null;
            }
            const result = Reflect.get(t, p, r);
            if (result !== undefined) return result;
            let addAPIMt = MemberTypes.Method | MemberTypes.Field | MemberTypes.Property;
            const cls = r.constructor;
            ensureStaticInherit(cls);
            if (cls.prototype === r) {
                return undefined
            }
            return addAPIHierarchy(r.GetType(), cls, p, false, addAPIMt) ? r[p] : undefined;
        };
        instanceProxyHandler.set = function (t, p, v, r) {
            const receiver = r;
            if (Reflect.has(t, p)) return Reflect.set(t, p, v, r);
            const cls = r.constructor;
            ensureStaticInherit(cls);
            if (cls.prototype === r) {
                return Reflect.set(t, p, v, r);
            }
            return addAPIHierarchy(r.GetType(), cls, p, false, MemberTypes.Field | MemberTypes.Property)
                ? ((receiver[p] = v), true)
                : Reflect.set(t, p, v, r);
        };
        puerts.__instance_lazy_proxy__ = new Proxy({}, instanceProxyHandler);
        Object.setPrototypeOf(CS.System.Object.prototype, puerts.__instance_lazy_proxy__);
    }

    function setupSystemObjectStaticLazyProxy() {
        if (puerts.__static_lazy_proxy__) return;
        const staticProxyHandler: ProxyHandler<object> = {};
        staticProxyHandler.get = function (t, p, r) {
            if (PUERTS_JS_CLASS_INNER_FIELDS.has(p)) return null;
            const result = Reflect.get(t, p, r);
            if (result !== undefined) return result;
            let addAPIMt = MemberTypes.Method | MemberTypes.Field | MemberTypes.Property;
            config.IS_INNER_CLASS_LAZY_ENABLED && (addAPIMt |= MemberTypes.NestedType);
            return addAPIHierarchy(puerts.$typeof(r), r, p, true, addAPIMt) ? r[p] : undefined;
        };
        staticProxyHandler.set = function (t, p, v, r) {
            if (
                Reflect.has(t, p) ||
                PUERTS_JS_CLASS_INNER_FIELDS.has(p) ||
                // in csharp.mjs:csTypeToClass, enum values will be set, skip api lookup
                (typeof(p) === 'string' && !isNaN(+p))
            ) {
                return Reflect.set(t, p, v, r);
            }
            const receiver = r;
            return addAPIHierarchy(puerts.$typeof(r), r, p, true, MemberTypes.Field | MemberTypes.Property)
                ? ((receiver[p] = v), true)
                : Reflect.set(t, p, v, r);
        };
        puerts.__static_lazy_proxy__ = new Proxy({}, staticProxyHandler);
        Object.setPrototypeOf(CS.System.Object, puerts.__static_lazy_proxy__);
    }

    function setupSystemObjectInnerClassLazyAccess() {
        // temporary way to patch getNestedTypes in csTypeToClass, to implement delayed inner class
        puerts.__originalPuertsGetNestedTypes ??= puerts.getNestedTypes;
        function getNestedTypesLazyInnerPatched(csTypeOrName: CSharp.System.Type | string) {
            if (config.IS_INNER_CLASS_LAZY_ENABLED) {
                return null;
            }
            return puerts.__originalPuertsGetNestedTypes(csTypeOrName);
        }
        puerts.getNestedTypes = getNestedTypesLazyInnerPatched;
    }

    function setupExtensionAPIAccessHook() {
        puerts.__originalPuerts$extension ??= puerts.$extension;
        function $extensionPatched(cls: JSClass, extension: JSClass) {
            if (IS_LAZY_API_ENABLED) {
                const arr = config.extensions.get(cls) ?? [];
                arr.push(extension);
                config.extensions.set(cls, arr);
                return;
            }
            return puerts.__originalPuerts$extension(cls, extension);
        }
        puerts.$extension = $extensionPatched;
    }

    function setupGenericMethodCache() {
        puerts.__originalPuerts$genericMethod ??= puerts.$genericMethod;
        function $genericMethodCached(cls: JSClass, methodName: string, ...args) {
            if (!config.IS_GENERIC_METHOD_CACHED) return puerts.__originalPuerts$genericMethod(cls, methodName, ...args);
            let apiName = '';
            try {
                apiName = `$${methodName}[${args.map(x => getClassName(x)).join(",")}]`;
                if (Object.prototype.hasOwnProperty.call(cls, apiName)) {
                    return cls[apiName];
                }
            } catch (e) {
                LL.W >= config.LL && log(LL.W, `generic method cache failed! With exception: ${e}`);
            }

            const api = puerts.__originalPuerts$genericMethod(cls, methodName, ...args)
            if (apiName) {
                Reflect.set(Object, apiName, api, cls);
            }
            return api;

        }
        puerts.$genericMethod = $genericMethodCached;
    }

    // setup
    setupGenericMethodCache();
    setupExtensionAPIAccessHook();
    setupSystemObjectInnerClassLazyAccess();
    setupSystemObjectInstanceLazyProxy();
    setupSystemObjectStaticLazyProxy();

    let IS_LAZY_API_ENABLED = false;
    const config = {
        IS_INNER_CLASS_LAZY_ENABLED: true, // optimize class import performance/memory usage, by delay import inner classes
        IS_CLEAR_LAZY_API_ENABLED: true, // optimize memory usage, by manually trigger LazyAPI.Clear()
        IS_SIMPLIFIED_GENERIC_ENABLED: false, // optimize code style, while accessing generic methods
        IS_GENERIC_METHOD_CACHED: true,
        LAZY_API_PROFILE_TIMER: -1, // set to -1 to disable profiler
        SET_LAZY_API_NAME: false,
        TO_CLEAR_API_JSCLASSES: new Set<JSClass>(), // for switch IS_CLEAR_LAZY_API_ENABLED
        extensions: new Map<unknown, JSClass[]>(),
        LL: LL.E, // LogLevel, set to LL.I to enable all logs
    };

    function SetEnabled(enabled: boolean, debug?: boolean) {
        config.LL = debug ? LL.I : LL.E;
        LL.I >= config.LL && log(LL.I, `enableLazyAPI: ${enabled}`);
        CSIMPL.SetEnabled(enabled);
        IS_LAZY_API_ENABLED = enabled;
        config.IS_INNER_CLASS_LAZY_ENABLED = enabled;
        if (enabled) {
            puerts.LazyAPI.AddAPI(CS.System.Type, "GetMember", false, 8 /* MemberTypes.Method */); // used by puer.getGenericMethod
        }
    }

    function Clear() {
        if (!config.IS_CLEAR_LAZY_API_ENABLED) return '';
        const clearInfo: string[] = [];
        for (const jsClass of config.TO_CLEAR_API_JSCLASSES) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
                if (Object.prototype.hasOwnProperty.call(jsClass, '__p_extensionAPIList')) {
                    for (const apiName of jsClass.__p_extensionAPIList!) {
                        LL.I >= config.LL && log(LL.I, `cleared api`, jsClass, apiName, false);
                        clearInfo.push(`[lazy_api] CSharp.${getClassName(jsClass)}, ${apiName}, false`);
                        delete jsClass.prototype[apiName];
                    }
                }
                continue;
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass))) {
                if (!descriptor.configurable || PUERTS_JS_CLASS_INNER_FIELDS.has(apiName)) continue;
                LL.I >= config.LL && log(LL.I, `cleared api`, jsClass, apiName, true);
                clearInfo.push(`[lazy_api] ${getClassName(jsClass)}::${apiName} 'static' cleared api`);
                delete jsClass[apiName];
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass.prototype))) {
                if (!descriptor.configurable || apiName === 'constructor') continue;
                LL.I >= config.LL && log(LL.I, `cleared api`, jsClass, apiName, false);
                clearInfo.push(`[lazy_api] ${getClassName(jsClass)}::${apiName} 'instance' cleared api`);
                delete jsClass.prototype[apiName];
            }
        }
        CSIMPL.ClearAllAPI();
        config.TO_CLEAR_API_JSCLASSES.clear();
        LL.I >= config.LL && log(LL.I, `cleared api total count: ${clearInfo.length}`);
        clearInfo.push(`[lazy_api] cleared api total count: ${clearInfo.length}`);
        return clearInfo.join('\n');
    }

    function Dump() {
        if (!config.IS_CLEAR_LAZY_API_ENABLED) return '';
        const dumpInfo: string[] = [];
        const addDumpInfo = (jsClass: JSClass, apiName: string, isStatic: boolean) => {
            const clsName = getClassName(jsClass);
            if (clsName.includes('`')) {
                dumpInfo.push(`// AddAPI(CSharp.${clsName}, '${apiName}', ${isStatic})`);
            } else {
                dumpInfo.push(`AddAPI(CSharp.${clsName}, '${apiName}', ${isStatic})`);
            }
        };
        for (const jsClass of config.TO_CLEAR_API_JSCLASSES) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) continue;
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass))) {
                if (PUERTS_JS_CLASS_INNER_FIELDS.has(apiName)) continue;
                if (!descriptor.configurable) continue;
                addDumpInfo(jsClass, apiName, true);
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass.prototype))) {
                if (apiName === 'constructor') continue;
                if (!descriptor.configurable) continue;
                addDumpInfo(jsClass, apiName, false);
            }
        }
        const csApplication = CS.UnityEngine.Application;
        const path = `${csApplication.dataPath}/../js_registered.txt`;
        LL.E >= config.LL && log(LL.E, `output dump: ${path}`);
        CS.System.IO.File.WriteAllText(path, dumpInfo.join('\n'));
    }

    class LazyAPI {
        static config = config;
        static Clear: () => string = Clear;
        static Dump: () => void = Dump;
        static SetEnabled: (enabled: boolean, debug?: boolean) => void = SetEnabled;
        static AddAPI = (cls, name, isStatic, memberTypes = 8 | 4 | 16 | 128) => {
            if (isStatic && name in cls) return;
            if (!isStatic && name in cls.prototype) return;
            addAPIHierarchy(puerts.$typeof(cls), cls, name, isStatic, memberTypes);
        };
    }
    puerts.LazyAPI = LazyAPI;
    return LazyAPI;
};

if (!puerts.LazyAPI) {
    REGISTER_LAZY_API();
    puerts.LazyAPI.SetEnabled(true);
}

declare module 'puerts' {
    // defined in lazy_api.ts
    type TypeLazyAPI = {
        config: {
            IS_INNER_CLASS_LAZY_ENABLED: true; // optimize class import performance/memory usage, by delay import inner classes
            IS_CLEAR_LAZY_API_ENABLED: true; // optimize memory usage, by manually trigger LazyAPI.Clear()
            IS_SIMPLIFIED_GENERIC_ENABLED: true; // optimize code style, while accessing generic methods
            LAZY_API_PROFILE_TIMER: -1; // set to -1 to disable profiler
            TO_CLEAR_API_JSCLASSES: Set<unknown>; // for switch IS_CLEAR_LAZY_API_ENABLED
            SET_LAZY_API_NAME: boolean; // useful for profiler show c# api names
            extensions: Map<unknown, unknown[]>;
            LL: number; // LogLevel, set to LL.I to enable all logs
        };
        Clear: () => string;
        Dump: () => void;
        SetEnabled: (enabled: boolean, debug?: boolean) => void;
    };
    const LazyAPI: TypeLazyAPI;
}
