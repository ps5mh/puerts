using System.IO;
using System.Reflection;
using System.Collections.Generic;
using Puerts;

namespace Puerts.UnitTest 
{
    public class UnitTestLoader2: IResolvableLoader, ILoader, IModuleChecker
    {

        public UnitTestLoader2()
        {

        }

        public bool IsESM(string filepath)
        {
            return !filepath.EndsWith(".cjs");
        }

        /**
        * 判断文件是否存在，并返回调整后文件标识符，供ReadFile使用。
        * localFilePath为文件本地路径，调试器调试时会使用。
        */
        [UnityEngine.Scripting.Preserve]
        public string Resolve(string specifier, string referrer)
        {
            if (PathHelper.IsRelative(specifier))
            {
                specifier = PathHelper.normalize(PathHelper.Dirname(referrer) + "/" + specifier);
            }

            string path = UnityEngine.Application.streamingAssetsPath + "/" + specifier;
            if (System.IO.File.Exists(path))
            {
                return path;
            }
            else if (mockFileContent.ContainsKey(specifier))
            {
                return specifier;
            }
            else if (mockFileContent.ContainsKey(specifier + "/index.js"))
            {
                return specifier + "/index.js";
            }
            else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null) 
            {
                return specifier;
            }
            else if (UnityEngine.Resources.Load(FixSpecifier(specifier + "/index.js")) != null) 
            {
                return specifier + "/index.js";
            }
            return null;
        }

        [UnityEngine.Scripting.Preserve]
        public bool FileExists(string specifier)
        {
            if (nullFiles.Contains(specifier)) return true;
            return !System.String.IsNullOrEmpty(Resolve(specifier, "."));
        }

        [UnityEngine.Scripting.Preserve]
        public string ReadFile(string specifier, out string debugpath)
        {
            if (nullFiles.Contains(specifier))
            {
                debugpath = string.Empty;
                return null;
            }
            debugpath = "";
            if (specifier != null) {
                if (specifier.StartsWith(UnityEngine.Application.streamingAssetsPath) || File.Exists(UnityEngine.Application.streamingAssetsPath + "/" + specifier)) {
                    return System.IO.File.ReadAllText(UnityEngine.Application.streamingAssetsPath + "/" + specifier);

                } else if (mockFileContent.ContainsKey(specifier)) {
                    return mockFileContent[specifier];

                } else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null) {
                    return UnityEngine.Resources.Load<UnityEngine.TextAsset>(FixSpecifier(specifier)).text;

                }
                }
            return "";
                }
        private Dictionary<string, string> mockFileContent = new Dictionary<string, string>();
        private string FixSpecifier(string specifier)
        {
            return 
            // .cjs/.mjs asset is only supported in unity2018+
    #if UNITY_2018_1_OR_NEWER
            specifier.EndsWith(".cjs") || specifier.EndsWith(".mjs")  ? 
                specifier.Substring(0, specifier.Length - 4) : 
    #endif
                specifier;
        }
        [UnityEngine.Scripting.Preserve]
        public void AddMockFileContent(string fileName, string content)
        {
            mockFileContent[fileName] = content;
        }
        
        private HashSet<string> nullFiles = new HashSet<string>();
        [UnityEngine.Scripting.Preserve]
        public void AddNullFile(string fileName)
        {
            nullFiles.Add(fileName);
        }
    }
    public class UnitTestLoader : ILoader
    {
        private string FixSpecifier(string specifier)
        {
            return 
            // .cjs/.mjs asset is only supported in unity2018+
    #if UNITY_2018_1_OR_NEWER
            specifier.EndsWith(".cjs") || specifier.EndsWith(".mjs")  ? 
                specifier.Substring(0, specifier.Length - 4) : 
    #endif
                specifier;
        }

        [UnityEngine.Scripting.Preserve]
        public bool FileExists(string specifier)
        {
            if (nullFiles.Contains(specifier)) return true;
            string path = UnityEngine.Application.streamingAssetsPath + "/" + specifier;
            if (System.IO.File.Exists(path))
            {
                return true;
            }
            else if (mockFileContent.ContainsKey(specifier)) 
            {
                return true;
            } 
            else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null) 
            {
                return true;
            }
            return false;
        }

        [UnityEngine.Scripting.Preserve]
        public string ReadFile(string specifier, out string debugpath)
        {
            if (nullFiles.Contains(specifier))
            {
                debugpath = string.Empty;
                return null;
            }
            debugpath = "";
            if (specifier != null) {
                if (specifier.StartsWith(UnityEngine.Application.streamingAssetsPath) || File.Exists(UnityEngine.Application.streamingAssetsPath + "/" + specifier)) {
                    return System.IO.File.ReadAllText(UnityEngine.Application.streamingAssetsPath + "/" + specifier);
                } else if (mockFileContent.ContainsKey(specifier)) {
                    return mockFileContent[specifier];
                } else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null) {
                    return UnityEngine.Resources.Load<UnityEngine.TextAsset>(FixSpecifier(specifier)).text;
                }
            }
            return "";
        }
        
        private Dictionary<string, string> mockFileContent = new Dictionary<string, string>();
        [UnityEngine.Scripting.Preserve]
        public void AddMockFileContent(string fileName, string content)
        {
            mockFileContent[fileName] = content;
        }
        
        private HashSet<string> nullFiles = new HashSet<string>();
        [UnityEngine.Scripting.Preserve]
        public void AddNullFile(string fileName)
        {
            nullFiles.Add(fileName);
        }
    }

    public class UnitTestLoaderByteCode : IResolvableLoader, ILoader, IModuleChecker, IByteCodeLoader
    {

        public UnitTestLoaderByteCode()
        {

        }

        public bool IsESM(string filepath)
        {
            return !filepath.EndsWith(".cjs");
        }

        /**
        * 判断文件是否存在，并返回调整后文件标识符，供ReadFile使用。
        * localFilePath为文件本地路径，调试器调试时会使用。
        */
        [UnityEngine.Scripting.Preserve]
        public string Resolve(string specifier, string referrer)
        {
            if (PathHelper.IsRelative(specifier))
            {
                specifier = PathHelper.normalize(PathHelper.Dirname(referrer) + "/" + specifier);
            }

            string path = UnityEngine.Application.streamingAssetsPath + "/" + specifier;
            if (System.IO.File.Exists(path))
            {
                return path;
            }
            else if (mockFileContent.ContainsKey(specifier))
            {
                return specifier;
            }
            else if (mockFileContent.ContainsKey(specifier + "/index.js"))
            {
                return specifier + "/index.js";
            }
            else if (UnityEngine.Resources.Load(specifier) != null)
            {
                return specifier;
            }
            else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null)
            {
                return specifier;
            }
            else if (UnityEngine.Resources.Load(specifier + "/index.js") != null)
            {
                return specifier + "/index.js";
            }
            return null;
        }

        [UnityEngine.Scripting.Preserve]
        public bool FileExists(string specifier)
        {
            if (nullFiles.Contains(specifier)) return true;
            return !System.String.IsNullOrEmpty(Resolve(specifier, "."));
        }

        [UnityEngine.Scripting.Preserve]
        public string ReadFile(string specifier, out string debugpath)
        {
            throw new System.Exception("use ReadFileBytes instead!");
        }

        [UnityEngine.Scripting.Preserve]
        public ArrayBuffer ReadFileBytes(string specifier, out string debugpath)
        {
            if (nullFiles.Contains(specifier))
            {
                debugpath = string.Empty;
                return null;
            }
            debugpath = "";
            byte[] bytes = null;
            if (specifier != null)
            {
                if (specifier.StartsWith(UnityEngine.Application.streamingAssetsPath) || File.Exists(UnityEngine.Application.streamingAssetsPath + "/" + specifier))
                {
                    bytes = System.IO.File.ReadAllBytes(UnityEngine.Application.streamingAssetsPath + "/" + specifier);
                }
                else if (mockFileContent.ContainsKey(specifier))
                {
                    bytes = System.Text.Encoding.UTF8.GetBytes(mockFileContent[specifier]);
                }
                else if (UnityEngine.Resources.Load(specifier) != null)
                {
                    bytes = UnityEngine.Resources.Load<UnityEngine.TextAsset>(specifier).bytes;
                }
                else if (UnityEngine.Resources.Load(FixSpecifier(specifier)) != null)
                {
                    bytes = UnityEngine.Resources.Load<UnityEngine.TextAsset>(FixSpecifier(specifier)).bytes;
                }
            }
            if (bytes != null)
            {
                return new ArrayBuffer(bytes);
            }
            return null;
        }
        private Dictionary<string, string> mockFileContent = new Dictionary<string, string>();
        private string FixSpecifier(string specifier)
        {
            return
            // .cjs/.mjs asset is only supported in unity2018+
#if UNITY_2018_1_OR_NEWER
            specifier.EndsWith(".cjs") || specifier.EndsWith(".mjs") ?
                specifier.Substring(0, specifier.Length - 4) :
#endif
                specifier;
        }
        [UnityEngine.Scripting.Preserve]
        public void AddMockFileContent(string fileName, string content)
        {
            mockFileContent[fileName] = content;
        }

        private HashSet<string> nullFiles = new HashSet<string>();
        [UnityEngine.Scripting.Preserve]
        public void AddNullFile(string fileName)
        {
            nullFiles.Add(fileName);
        }
    }
}