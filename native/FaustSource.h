#pragma once
#include <cctype>
#include <stdexcept>
#include <string>
#include <string_view>

namespace sg {
// Native presets support ordinary signal expressions, UI controls and the
// installed stdfaust.lib. File/URL imports, soundfiles and FFI are excluded.
inline std::string checkedFaustSource(std::string_view code, const std::string& standardLibrary) {
    if (code.empty() || code.size() > 60000 || code.find('\0') != code.npos)
        throw std::runtime_error("Invalid Faust source length or embedded NUL");
    size_t pos = 0, last = 0;
    std::string checked;
    auto token = [&]() -> std::string_view {
        while (pos < code.size()) {
            if (std::isspace(static_cast<unsigned char>(code[pos]))) { ++pos; continue; }
            if (code.substr(pos, 2) == "//") {
                pos = code.find_first_of("\r\n", pos + 2);
                if (pos == code.npos) pos = code.size();
                continue;
            }
            if (code.substr(pos, 2) == "/*") {
                auto end = code.find("*/", pos + 2);
                if (end == code.npos) throw std::runtime_error("Unterminated Faust comment");
                pos = end + 2; continue;
            }
            break;
        }
        size_t begin = pos;
        if (pos == code.size()) return {};
        const char c = code[pos++];
        if (c == '"') {
            while (pos < code.size()) {
                const char v = code[pos++];
                if (v == '"') return code.substr(begin, pos - begin);
                if (v == '\\' && pos < code.size()) ++pos;
            }
            throw std::runtime_error("Unterminated Faust string");
        }
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '_')
            while (pos < code.size() && (std::isalnum(static_cast<unsigned char>(code[pos])) || code[pos] == '_')) ++pos;
        return code.substr(begin, pos - begin);
    };
    for (;;) {
        const auto t = token();
        if (t.empty()) break;
        if (t == "ffunction" || t == "fvariable" || t == "fconstant" || t == "soundfile")
            throw std::runtime_error("Native patches do not support Faust FFI or soundfiles");
        if (t == "import" || t == "component" || t == "library") {
            if (token() != "(" || token() != "\"stdfaust.lib\"")
                throw std::runtime_error("Only the installed stdfaust.lib can be imported");
            const size_t literalEnd = pos, literalBegin = pos - sizeof("\"stdfaust.lib\"") + 1;
            if (token() != ")") throw std::runtime_error("Invalid Faust import");
            checked.append(code.substr(last, literalBegin - last));
            checked += '"'; checked += standardLibrary; checked += '"';
            last = literalEnd;
        }
    }
    checked.append(code.substr(last));
    return checked;
}
}
