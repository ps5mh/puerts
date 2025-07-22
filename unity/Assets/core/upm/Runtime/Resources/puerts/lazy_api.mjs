/**
 * Lazy API Utilities
 * @author bingcongni
 * @see https://iwiki.woa.com/p/4008334693
 */
const { puerts, CS, console: logger } = global;
const REGISTER_LAZY_API = function () {
    // declear c# implemented APIs defined in DynamicBinder.cs
    const bridge = CS.Puerts.LazyAPINative;
    const CSIMPL = {
        /**
         * @returns fieldvalue, if memberType === (MemberTypes.Field | MemberTypes.StaticConst)
         *          type, if memberType === MemberTypes.NestedType
         *          funcion, if memberType === MemberTypes.Field || memberType === MemberTypes.Property || memberType === MemberTypes.Method
         *          null, if memberType === 0
         */
        RegisterAPI(csType, apiName, memberType, bindingFlags) {
            return bridge.RegisterAPI(csType, apiName, memberType, bindingFlags);
        },
        ClearAllAPI: bridge.ClearAllAPI,
        SetEnabled: bridge.SetEnabled,
    };
    const PUERTS_JS_CLASS_INNER_FIELDS = new Set([
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
    const LOG_FUNCS = {
        [0 /* LL.I */]: logger.log,
        [1 /* LL.D */]: logger.log,
        [2 /* LL.W */]: logger.warn,
        [3 /* LL.E */]: logger.error,
    };
    const getClassName = (jsClass) => jsClass.name?.split(',')[0] ?? "";
    function log(ll, info, jsClass, apiName, isStatic) {
        if (ll < config.LL)
            return;
        let logstr = info;
        if (jsClass && apiName) {
            const className = getClassName(jsClass);
            logstr = `${className}::${apiName.toString()} ${isStatic ? 'static' : 'instance'} ${info}`;
        }
        LOG_FUNCS[ll](`[JS] [lazy_api] ${logstr}\n ${new Error().stack}`);
    }
    // #endregion
    function wrapAPI(csType, jsClass, apiName, api, isStatic, csMemberType, bflags) {
        const addAPITarget = isStatic ? jsClass : jsClass.prototype;
        // const api = CSIMPL.RegisterAPI(csType, apiName, csMemberType, bflags);
        if (api === null || api === undefined) {
            3 /* LL.E */ >= config.LL && log(3 /* LL.E */, 'RegisterAPI inner failed', jsClass, apiName, isStatic);
            return false;
        }
        if (csMemberType === (4 /* MemberTypes.Field */ | 256 /* MemberTypes.StaticConst */)) {
            Object.defineProperty(addAPITarget, apiName, {
                value: api,
                writable: false,
                configurable: true,
                enumerable: false,
            });
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'getter register const api success', jsClass, apiName, isStatic);
            return true;
        }
        if (csMemberType === 128 /* MemberTypes.NestedType */ && config.IS_INNER_CLASS_LAZY_ENABLED && isStatic) {
            // try access api as inner class
            const ok = addNestedType(csType, jsClass, apiName, api);
            return ok;
        }
        if (csMemberType & (4 /* MemberTypes.Field */ | 16 /* MemberTypes.Property */)) {
            Object.defineProperty(addAPITarget, apiName, {
                get: (csMemberType & 512 /* MemberTypes.SetterOnly */) ? undefined : api,
                set: api,
                configurable: true,
                enumerable: false,
            });
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'getter/setter register api success', jsClass, apiName, isStatic);
            return true;
        }
        if (csMemberType === 8 /* MemberTypes.Method */) {
            const isExtensionMethod = !isStatic && (bflags & 8 /* BindingFlags.Static */);
            if (isExtensionMethod) {
                const extApi = function (...args) {
                    return api.call(null, this, ...args);
                };
                Reflect.set(Object, apiName, extApi, addAPITarget);
                1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'extension method register api success', jsClass, apiName, isStatic);
                return true;
            }
            if (config.SET_LAZY_API_NAME) {
                const apiNamed = eval(`(api) => {return function ${apiName}(...args){return api.call(this, ...args)}}`)(api);
                Reflect.set(Object, apiName, apiNamed, addAPITarget);
                1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'method register api success', jsClass, apiName, isStatic);
                return true;
            }
            Reflect.set(Object, apiName, api, addAPITarget);
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'method register api success', jsClass, apiName, isStatic);
            return true;
        }
        return false;
    }
    function addExtensionAPI(csType, jsClass, apiName, extClses) {
        if (!extClses)
            return false;
        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'check extension class', jsClass, apiName, false);
        const flags = 16 /* BindingFlags.Public */ | 2 /* BindingFlags.DeclaredOnly */ | 8 /* BindingFlags.Static */;
        let api;
        for (const extCls of extClses) {
            if (!extCls)
                continue;
            const tryExtType = puerts.$typeof(extCls);
            if (!tryExtType)
                continue;
            const typesRef = puerts.$ref(8 /* MemberTypes.Method */);
            api = CSIMPL.RegisterAPI(tryExtType, apiName, typesRef, flags);
            if (puerts.$unref(typesRef) === 8 /* MemberTypes.Method */) {
                break;
            }
        }
        if (api === null || api === undefined)
            return false;
        const ok = wrapAPI(csType, jsClass, apiName, api, false, 8 /* MemberTypes.Method */, flags);
        if (ok) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
                if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_extensionAPIList')) {
                    const cls = jsClass;
                    cls.__p_extensionAPIList = [];
                }
                jsClass.__p_extensionAPIList.push(apiName);
            }
            return true;
        }
        return false;
    }
    function addEnumAPI(csType, jsClass, apiName) {
        if (!isNaN(+apiName)) {
            if (!csType)
                return false;
            const enumName = CS.System.Enum.GetName(csType, new CS.Puerts.Int32Value(+apiName));
            Object.defineProperty(jsClass, apiName, {
                value: enumName,
                writable: false,
                configurable: true,
                enumerable: false,
            });
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'enum(int32 key) register api success', jsClass, apiName, true);
            return true;
        }
        const ok = addAPI(csType, jsClass, apiName, true, 4 /* MemberTypes.Field */);
        if (ok) {
            return true;
        }
        return false;
    }
    function addGenericAPI(jsClass, apiName, isStatic) {
        const apiNameImpl = apiName.substring(1);
        const api = function (typeArg, ...args) {
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, `call generic method: ${typeArg.length}`, jsClass, apiName, isStatic);
            const apiImpl = puerts.$genericMethod(jsClass, apiNameImpl, ...typeArg);
            return apiImpl.call(this, ...args);
        };
        Reflect.set(Object, apiName, api, isStatic ? jsClass : jsClass.prototype);
        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'generic method register api success', jsClass, apiName, isStatic);
        return true;
    }
    function addNestedType(csType, jsClass, apiName, innerType) {
        const flags = 4 /* BindingFlags.Instance */ | 8 /* BindingFlags.Static */ | 16 /* BindingFlags.Public */;
        innerType = innerType ?? csType.GetNestedType(apiName.replace('$', '`'), flags);
        if (innerType) {
            if (innerType.IsGenericTypeDefinition && csType.IsGenericType) {
                const genericArgs = csType.GetGenericArguments();
                const genericArgsJS = [];
                for (let i = 0; i < genericArgs.Length; i++) {
                    genericArgsJS.push(genericArgs.get_Item(i));
                }
                const api = puerts.$csTypeToClass(innerType.MakeGenericType(...genericArgsJS));
                Object.defineProperty(jsClass, apiName, { configurable: false, value: api, writable: false });
                1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'NestedType register api success, inner class of generic class', jsClass, apiName, true);
                return true;
            }
            const api = puerts.$csTypeToClass(innerType);
            Object.defineProperty(jsClass, apiName, { configurable: false, value: api, writable: false });
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'NestedType register api success', jsClass, apiName, true);
            return true;
        }
    }
    function addPrivateInterfaceProperty(csType, jsClass, apiName) {
        const flagsNonPub = 4 /* BindingFlags.Instance */ | 32 /* BindingFlags.NonPublic */ | 2 /* BindingFlags.DeclaredOnly */;
        const properties = csType.GetProperties(flagsNonPub);
        for (let i = 0; i < properties.Length; i++) {
            const prop = properties.get_Item(i);
            if (prop.Name.endsWith("." + apiName)) {
                const api = CSIMPL.RegisterAPI(csType, prop.Name, puerts.$ref(16 /* MemberTypes.Property */), flagsNonPub);
                Object.defineProperty(jsClass.prototype, apiName, {
                    get: api,
                    set: api,
                    configurable: true,
                    enumerable: false,
                });
                1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'getter/setter register api success(private)', jsClass, apiName, false);
                return true;
            }
        }
        return false;
    }
    function addAPI(csType, jsClass, apiName, isStatic, filterMemberTypes) {
        if (!csType) {
            2 /* LL.W */ >= config.LL && log(2 /* LL.W */, 'bad state, csType is null', jsClass, apiName, isStatic);
            return false;
        }
        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'try api register', jsClass, apiName, isStatic);
        if (jsClass === CS.System.Object) {
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'api register fail reach System.Object', jsClass, apiName, isStatic);
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList') &&
            jsClass.__p_notFoundAPIList.get(apiName) === isStatic) {
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'api register fail __p_notFoundAPIList', jsClass, apiName, isStatic);
            return false;
        }
        if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
            if (!isStatic) {
                // try add as extension api, even if this class was not registered as __p_isUseLazyAPI
                const ok = addExtensionAPI(csType, jsClass, apiName, config.extensions.get(jsClass));
                if (ok)
                    return ok;
            }
            else if (isStatic && config.IS_INNER_CLASS_LAZY_ENABLED) {
                // try add as inner class api when IS_INNER_CLASS_LAZY_ENABLED, even if this class was not registered as __p_isUseLazyAPI
                const ok = addNestedType(csType, jsClass, apiName);
                if (ok)
                    return ok;
            }
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'api register fail __p_isUseLazyAPI', jsClass, apiName, isStatic);
            return undefined;
        }
        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'begin api register', jsClass, apiName, isStatic);
        const bindingFlags = 16 /* BindingFlags.Public */ | 2 /* BindingFlags.DeclaredOnly */
            | (isStatic ? 8 /* BindingFlags.Static */ : 4 /* BindingFlags.Instance */)
            | 32 /* BindingFlags.NonPublic */; // to support IEnumerator.MoveNext
        const memberTypeRef = puerts.$ref(filterMemberTypes);
        const api = CSIMPL.RegisterAPI(csType, apiName, memberTypeRef, bindingFlags);
        const csMemberType = puerts.$unref(memberTypeRef);
        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, `get member type: ${csMemberType}`, jsClass, apiName, isStatic);
        if (csMemberType === 0 /* MemberTypes.Invalid */ || api === null || api === undefined) {
            if (!isStatic) {
                let ok = addExtensionAPI(csType, jsClass, apiName, config.extensions.get(jsClass));
                if (ok)
                    return ok;
            }
        }
        else {
            const ok = wrapAPI(csType, jsClass, apiName, api, isStatic, csMemberType, bindingFlags);
            if (ok)
                return ok;
        }
        // return undefined will search parent
        return undefined;
    }
    function addAPIHierarchy(csType, jsClass, apiName, isStatic, filterMemberTypes) {
        try {
            if (typeof apiName !== 'string')
                return false;
            if (Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList') &&
                jsClass.__p_notFoundAPIList.get(apiName) === isStatic) {
                1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'api register fail __p_notFoundAPIList', jsClass, apiName, isStatic);
                return false;
            }
            let begin;
            if (config.LAZY_API_PROFILE_TIMER !== -1)
                begin = Date.now();
            if (config.IS_SIMPLIFIED_GENERIC_ENABLED && apiName.startsWith('$')) {
                const ok = addGenericAPI(jsClass, apiName, isStatic);
                ok && config.TO_CLEAR_API_JSCLASSES.add(jsClass);
                if (config.LAZY_API_PROFILE_TIMER !== -1)
                    config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                return ok;
            }
            if (IS_LAZY_API_ENABLED) {
                if (isStatic && csType.IsEnum) {
                    const ok = addEnumAPI(csType, jsClass, apiName);
                    if (ok) {
                        config.TO_CLEAR_API_JSCLASSES.add(jsClass);
                        if (config.LAZY_API_PROFILE_TIMER !== -1)
                            config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                        return ok;
                    }
                }
                let curClass = jsClass;
                let curType = csType;
                let level = 0;
                while (true) {
                    const ok = addAPI(curType, curClass, apiName, isStatic, filterMemberTypes);
                    if (ok === false)
                        break;
                    else if (ok) {
                        if (level > 1) {
                            2 /* LL.W */ >= config.LL &&
                                log(2 /* LL.W */, `slow addApi recursive level: ${level}`, jsClass, apiName, isStatic);
                        }
                        config.TO_CLEAR_API_JSCLASSES.add(curClass);
                        if (config.LAZY_API_PROFILE_TIMER !== -1)
                            config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
                        return ok;
                    }
                    else if (ok === undefined) {
                        curClass = Object.getPrototypeOf(curClass);
                        curType = curType.BaseType;
                        1 /* LL.D */ >= config.LL && log(1 /* LL.D */, `try parent: ${curClass.name} ${csType.Name}`, jsClass, apiName, isStatic);
                        level = level + 1;
                    }
                }
            }
            if (!isStatic) {
                // to support IEnumerator.Current
                const ok = addPrivateInterfaceProperty(csType, jsClass, apiName);
                if (ok)
                    return ok;
            }
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_notFoundAPIList')) {
                const cls = jsClass;
                cls.__p_notFoundAPIList = new Map();
            }
            jsClass.__p_notFoundAPIList.set(apiName, isStatic);
            2 /* LL.W */ >= config.LL && log(2 /* LL.W */, 'register api failed!', jsClass, apiName, isStatic);
            if (config.LAZY_API_PROFILE_TIMER !== -1)
                config.LAZY_API_PROFILE_TIMER += Date.now() - begin;
        }
        catch (e) {
            3 /* LL.E */ >= config.LL && log(3 /* LL.E */, `register api failed! With exception: ${e} ${e.stack}`, jsClass, apiName.toString(), isStatic);
        }
        return false;
    }
    function ensureStaticInherit(cls) {
        if (!cls.__static_inherit__) {
            1 /* LL.D */ >= config.LL && log(1 /* LL.D */, 'ensureStaticInherit', cls, "", false);
            let currentCls = cls, parentPrototype = Object.getPrototypeOf(currentCls.prototype);
            // 此处parentPrototype如果是一个泛型，会丢失父父的继承信息，必须循环找下去
            while (parentPrototype) {
                Object.setPrototypeOf(currentCls, parentPrototype.constructor); //v8 api的inherit并不能把静态属性也继承，通过这种方式修复下
                currentCls.__static_inherit__ = true;
                currentCls = parentPrototype.constructor;
                parentPrototype = Object.getPrototypeOf(currentCls.prototype);
                if (currentCls === Object || currentCls === Function || currentCls.__static_inherit__)
                    break;
            }
        }
    }
    function setupSystemObjectInstanceLazyProxy() {
        if (puerts.__instance_lazy_proxy__)
            return;
        const instanceProxyHandler = {};
        instanceProxyHandler.get = function (t, p, r) {
            if (p === 'prototype') {
                return null;
            }
            const result = Reflect.get(t, p, r);
            if (result !== undefined)
                return result;
            let addAPIMt = 8 /* MemberTypes.Method */ | 4 /* MemberTypes.Field */ | 16 /* MemberTypes.Property */;
            const cls = r.constructor;
            ensureStaticInherit(cls);
            const csType = cls.prototype === r ? puerts.$typeof(cls) : r.GetType();
            return addAPIHierarchy(csType, cls, p, false, addAPIMt) ? r[p] : undefined;
        };
        instanceProxyHandler.set = function (t, p, v, r) {
            const receiver = r;
            if (Reflect.has(t, p))
                return Reflect.set(t, p, v, r);
            const cls = r.constructor;
            ensureStaticInherit(cls);
            if (cls.prototype === r) {
                return Reflect.set(t, p, v, r);
            }
            return addAPIHierarchy(r.GetType(), cls, p, false, 4 /* MemberTypes.Field */ | 16 /* MemberTypes.Property */)
                ? ((receiver[p] = v), true)
                : Reflect.set(t, p, v, r);
        };
        puerts.__instance_lazy_proxy__ = new Proxy({}, instanceProxyHandler);
        Object.setPrototypeOf(CS.System.Object.prototype, puerts.__instance_lazy_proxy__);
    }
    function setupSystemObjectStaticLazyProxy() {
        if (puerts.__static_lazy_proxy__)
            return;
        const staticProxyHandler = {};
        staticProxyHandler.get = function (t, p, r) {
            if (PUERTS_JS_CLASS_INNER_FIELDS.has(p))
                return null;
            const result = Reflect.get(t, p, r);
            if (result !== undefined)
                return result;
            let addAPIMt = 8 /* MemberTypes.Method */ | 4 /* MemberTypes.Field */ | 16 /* MemberTypes.Property */;
            config.IS_INNER_CLASS_LAZY_ENABLED && (addAPIMt |= 128 /* MemberTypes.NestedType */);
            return addAPIHierarchy(puerts.$typeof(r), r, p, true, addAPIMt) ? r[p] : undefined;
        };
        staticProxyHandler.set = function (t, p, v, r) {
            if (Reflect.has(t, p) ||
                PUERTS_JS_CLASS_INNER_FIELDS.has(p) ||
                // in csharp.mjs:csTypeToClass, enum values will be set, skip api lookup
                (typeof (p) === 'string' && !isNaN(+p))) {
                return Reflect.set(t, p, v, r);
            }
            const receiver = r;
            return addAPIHierarchy(puerts.$typeof(r), r, p, true, 4 /* MemberTypes.Field */ | 16 /* MemberTypes.Property */)
                ? ((receiver[p] = v), true)
                : Reflect.set(t, p, v, r);
        };
        puerts.__static_lazy_proxy__ = new Proxy({}, staticProxyHandler);
        Object.setPrototypeOf(CS.System.Object, puerts.__static_lazy_proxy__);
    }
    function setupSystemObjectInnerClassLazyAccess() {
        // temporary way to patch getNestedTypes in csTypeToClass, to implement delayed inner class
        puerts.__originalPuertsGetNestedTypes ?? (puerts.__originalPuertsGetNestedTypes = puerts.getNestedTypes);
        function getNestedTypesLazyInnerPatched(csTypeOrName) {
            if (config.IS_INNER_CLASS_LAZY_ENABLED) {
                return null;
            }
            return puerts.__originalPuertsGetNestedTypes(csTypeOrName);
        }
        puerts.getNestedTypes = getNestedTypesLazyInnerPatched;
    }
    function setupExtensionAPIAccessHook() {
        puerts.__originalPuerts$extension ?? (puerts.__originalPuerts$extension = puerts.$extension);
        function $extensionPatched(cls, extension) {
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
        puerts.__originalPuerts$genericMethod ?? (puerts.__originalPuerts$genericMethod = puerts.$genericMethod);
        function $genericMethodCached(cls, methodName, ...args) {
            if (!config.IS_GENERIC_METHOD_CACHED)
                return puerts.__originalPuerts$genericMethod(cls, methodName, ...args);
            let apiName = '';
            try {
                apiName = `$${methodName}[${args.map(x => getClassName(x)).join(",")}]`;
                if (Object.prototype.hasOwnProperty.call(cls, apiName)) {
                    return cls[apiName];
                }
            }
            catch (e) {
                2 /* LL.W */ >= config.LL && log(2 /* LL.W */, `generic method cache failed! With exception: ${e}`);
            }
            const api = puerts.__originalPuerts$genericMethod(cls, methodName, ...args);
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
        TO_CLEAR_API_JSCLASSES: new Set(), // for switch IS_CLEAR_LAZY_API_ENABLED
        extensions: new Map(),
        LL: 3 /* LL.E */, // LogLevel, set to LL.I to enable all logs
    };
    function SetEnabled(enabled, debug) {
        config.LL = debug ? 0 /* LL.I */ : 3 /* LL.E */;
        0 /* LL.I */ >= config.LL && log(0 /* LL.I */, `enableLazyAPI: ${enabled}`);
        CSIMPL.SetEnabled(enabled);
        IS_LAZY_API_ENABLED = enabled;
        config.IS_INNER_CLASS_LAZY_ENABLED = enabled;
        if (enabled) {
            puerts.LazyAPI.AddAPI(CS.System.Type, "GetMember", false, 8 /* MemberTypes.Method */); // used by puer.getGenericMethod
        }
    }
    function Clear() {
        if (!config.IS_CLEAR_LAZY_API_ENABLED)
            return '';
        const clearInfo = [];
        for (const jsClass of config.TO_CLEAR_API_JSCLASSES) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI')) {
                if (Object.prototype.hasOwnProperty.call(jsClass, '__p_extensionAPIList')) {
                    for (const apiName of jsClass.__p_extensionAPIList) {
                        0 /* LL.I */ >= config.LL && log(0 /* LL.I */, `cleared api`, jsClass, apiName, false);
                        clearInfo.push(`[lazy_api] CSharp.${getClassName(jsClass)}, ${apiName}, false`);
                        delete jsClass.prototype[apiName];
                    }
                }
                continue;
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass))) {
                if (!descriptor.configurable || PUERTS_JS_CLASS_INNER_FIELDS.has(apiName))
                    continue;
                0 /* LL.I */ >= config.LL && log(0 /* LL.I */, `cleared api`, jsClass, apiName, true);
                clearInfo.push(`[lazy_api] ${getClassName(jsClass)}::${apiName} 'static' cleared api`);
                delete jsClass[apiName];
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass.prototype))) {
                if (!descriptor.configurable || apiName === 'constructor')
                    continue;
                0 /* LL.I */ >= config.LL && log(0 /* LL.I */, `cleared api`, jsClass, apiName, false);
                clearInfo.push(`[lazy_api] ${getClassName(jsClass)}::${apiName} 'instance' cleared api`);
                delete jsClass.prototype[apiName];
            }
        }
        CSIMPL.ClearAllAPI();
        config.TO_CLEAR_API_JSCLASSES.clear();
        0 /* LL.I */ >= config.LL && log(0 /* LL.I */, `cleared api total count: ${clearInfo.length}`);
        clearInfo.push(`[lazy_api] cleared api total count: ${clearInfo.length}`);
        return clearInfo.join('\n');
    }
    function Dump() {
        if (!config.IS_CLEAR_LAZY_API_ENABLED)
            return '';
        const dumpInfo = [];
        const addDumpInfo = (jsClass, apiName, isStatic) => {
            const clsName = getClassName(jsClass);
            if (clsName.includes('`')) {
                dumpInfo.push(`// AddAPI(CSharp.${clsName}, '${apiName}', ${isStatic})`);
            }
            else {
                dumpInfo.push(`AddAPI(CSharp.${clsName}, '${apiName}', ${isStatic})`);
            }
        };
        for (const jsClass of config.TO_CLEAR_API_JSCLASSES) {
            if (!Object.prototype.hasOwnProperty.call(jsClass, '__p_isUseLazyAPI'))
                continue;
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass))) {
                if (PUERTS_JS_CLASS_INNER_FIELDS.has(apiName))
                    continue;
                if (!descriptor.configurable)
                    continue;
                addDumpInfo(jsClass, apiName, true);
            }
            for (const [apiName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(jsClass.prototype))) {
                if (apiName === 'constructor')
                    continue;
                if (!descriptor.configurable)
                    continue;
                addDumpInfo(jsClass, apiName, false);
            }
        }
        const csApplication = CS.UnityEngine.Application;
        const path = `${csApplication.dataPath}/../js_registered.txt`;
        3 /* LL.E */ >= config.LL && log(3 /* LL.E */, `output dump: ${path}`);
        CS.System.IO.File.WriteAllText(path, dumpInfo.join('\n'));
    }
    class LazyAPI {
    }
    LazyAPI.config = config;
    LazyAPI.Clear = Clear;
    LazyAPI.Dump = Dump;
    LazyAPI.addAPIHierarchy = addAPIHierarchy;
    LazyAPI.SetEnabled = SetEnabled;
    LazyAPI.AddAPI = (cls, name, isStatic, memberTypes = 8 | 4 | 16 | 128) => {
        if (isStatic && name in cls)
            return;
        if (!isStatic && name in cls.prototype)
            return;
        addAPIHierarchy(puerts.$typeof(cls), cls, name, isStatic, memberTypes);
    };
    puerts.LazyAPI = LazyAPI;
    return LazyAPI;
};
if (!puerts.LazyAPI) {
    REGISTER_LAZY_API();
    puerts.LazyAPI.SetEnabled(true);
}
export {};
