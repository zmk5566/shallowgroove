#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace sg {
class Probes;
using Values = std::map<std::string, float>;
struct Effect {
    std::string id, code;
    Values values;
    bool bypass = false, wetOnly = false;
};
struct Rack {
    std::string instrument;
    std::vector<Effect> effects;
    float gain = 1, pan = 0;
    Values values;
};
struct Parameter {
    std::string device, address, label;
    float min, max, step, init;
    std::uint32_t id;
};
struct Midi { int offset; std::uint8_t status, data1, data2;
    // Hardware routes own their voices and carry the input pedal state at note-off.
    std::uint64_t source=0;
    bool sustain=false; };
struct ParameterChange { int offset; std::uint32_t id; float value; };
std::uint32_t parameterId(std::string_view device, std::string_view address) noexcept;

class Core {
public:
    Core();
    ~Core(); // The audio device must already be stopped.
    Core(const Core&) = delete;
    Core& operator=(const Core&) = delete;
    // Control thread. Compilation failures throw and keep the active graph playing.
    void load(const Rack&, double sampleRate);
    std::vector<Parameter> parameters() const;
    Probes& probes() noexcept; // Standalone host lock must exclude concurrent render calls.
    bool setParameter(std::string_view device, std::string_view address, float value);
    bool setBypass(std::string_view effectId, bool bypass);
    void setMix(float gain, float pan) noexcept;
    void reset() noexcept;
    // Non-realtime only. Offline rendering can advance faster than the recycler.
    void prepareOfflineBlock();
    // Single audio consumer. Events are sorted by frame offset, in [0, frames).
    void render(float* left, float* right, int frames, std::span<const Midi> midi = {},
                std::span<const ParameterChange> automation = {},
                const float* inL=nullptr, const float* inR=nullptr) noexcept;
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}
