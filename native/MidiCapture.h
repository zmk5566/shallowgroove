#pragma once
#include <cstdint>

namespace sg::standalone {
struct MidiCapture {
    int track;
    bool controller;
    bool needed() const { return controller || track >= 0; }
};

// Instrument routes are independent. Fan-out never multiplies renderer events.
inline MidiCapture captureMidi(std::uint8_t status, int armedTrack) {
    const auto kind = status >> 4;
    return {armedTrack, kind == 0xb || kind == 0xd || kind == 0xe};
}
}
