#pragma once
#include <filesystem>
#ifdef _WIN32
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
#else
 #include <dlfcn.h>
#endif
namespace sg {
inline std::filesystem::path bundledFaustLibrary(){
 static int location;
 std::filesystem::path module;
#ifdef _WIN32
 HMODULE handle{};
 if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCWSTR>(&location),&handle))return {};
 wchar_t path[32768];auto size=GetModuleFileNameW(handle,path,32768);
 if(!size||size>=32768)return {};
 module=std::filesystem::path(path);
#else
 Dl_info info{};
 if(!dladdr(&location,&info)||!info.dli_fname)return {};
 module=info.dli_fname;
#endif
 auto directory=module.parent_path().parent_path()/"Resources"/"faust";
 std::error_code error;
 return std::filesystem::is_regular_file(directory/"stdfaust.lib",error)?directory:std::filesystem::path{};
}
}
