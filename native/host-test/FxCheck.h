#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <cmath>
#include <stdexcept>

namespace {
void fxRequire(bool passed, const char* message) {
    if (!passed) throw std::runtime_error(message);
}

juce::MemoryBlock saveState(juce::AudioPluginInstance& instance) {
    juce::MemoryBlock state;
    instance.getStateInformation(state);
    return state;
}

// JUCE wraps an opaque VST3 IComponent stream in binary XML. Its own VST3
// wrapper appends private bypass information after the processor's JSON.
juce::var readPatch(juce::AudioPluginInstance& instance) {
    const auto state = saveState(instance);
    auto xml = juce::AudioProcessor::getXmlFromBinary(state.getData(), static_cast<int>(state.getSize()));
    auto* component = xml ? xml->getChildByName("IComponent") : nullptr;
    juce::MemoryBlock bytes;
    fxRequire(component && bytes.fromBase64Encoding(component->getAllSubText()) && bytes.getSize(),
              "FX component state missing");
    const auto* data = static_cast<const char*>(bytes.getData());
    const auto* end = std::find(data, data + bytes.getSize(), '\0');
    auto patch = juce::JSON::parse(juce::String::fromUTF8(data, static_cast<int>(end - data)));
    fxRequire(patch["format"].toString() == "shallowgroove-fx-v1", "Unexpected FX state format");
    return patch;
}

void restore(juce::AudioPluginInstance& instance, const juce::MemoryBlock& state) {
    instance.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
}

void loadPatch(juce::AudioPluginInstance& instance, const juce::var& patch) {
    const auto json = juce::JSON::toString(patch);
    juce::MemoryBlock bytes(json.toRawUTF8(), json.getNumBytesAsUTF8());
    juce::XmlElement xml("VST3PluginState");
    xml.createNewChildElement("IComponent")->addTextElement(bytes.toBase64Encoding());
    juce::MemoryBlock state;
    juce::AudioProcessor::copyXmlToBinary(xml, state);
    restore(instance, state);
}

void checkSignal(juce::AudioPluginInstance& instance, int frames, float leftGain, float rightGain) {
    juce::AudioBuffer<float> buffer(2, frames);
    juce::MidiBuffer midi;
    // Patches crossfade for 10 ms at 48 kHz. Measure the new patch after the fade.
    for (int consumed = 0; consumed < 480; consumed += frames) {
        buffer.clear();
        instance.processBlock(buffer, midi);
    }
    for (int i = 0; i < frames; ++i) {
        buffer.setSample(0, i, i % 2 == 0 ? .8f : -.2f);
        buffer.setSample(1, i, i % 3 == 0 ? -.4f : .6f);
    }
    juce::AudioBuffer<float> input;
    input.makeCopyOf(buffer);
    instance.processBlock(buffer, midi);
    for (int ch = 0; ch < 2; ++ch) {
        const auto gain = ch == 0 ? leftGain : rightGain;
        for (int i = 0; i < frames; ++i) {
            const float actual = buffer.getSample(ch, i);
            const float expected = input.getSample(ch, i) * gain;
            if (!(std::abs(actual - expected) < 1.0e-5f))
                throw std::runtime_error("FX channel " + std::to_string(ch) + ", sample " + std::to_string(i)
                                         + ": expected " + std::to_string(expected) + ", got " + std::to_string(actual));
        }
    }
}

void checkFxProcessing(juce::AudioPluginInstance& first, juce::AudioPluginInstance& second, int frames) {
    auto patch = readPatch(first);
    auto* data = patch.getDynamicObject();
    const juce::String code = "gain = hslider(\"Level\", 0.5, 0, 1, 0.01); process = *(gain), *(-0.25);";
    data->setProperty("name", "Stereo host probe");
    data->setProperty("code", code);
    data->setProperty("values", juce::var(new juce::DynamicObject()));
    loadPatch(first, patch);
    checkSignal(first, frames, .5f, -.25f);
    auto edited = readPatch(first);
    auto* values = edited["values"].getDynamicObject();
    fxRequire(values && values->getProperties().size() == 1, "Expected one saved Faust slider");
    const auto address = values->getProperties().getName(0);
    values->setProperty(address, .32);
    loadPatch(first, edited);
    checkSignal(first, frames, .32f, -.25f);
    const auto saved = saveState(first);

    data->setProperty("code", "process = *(0.75), *(0.125);");
    loadPatch(second, patch);
    checkSignal(second, frames, .75f, .125f);
    checkSignal(first, frames, .32f, -.25f);

    data->setProperty("code", "process = invalid_faust_identifier;");
    loadPatch(first, patch);
    checkSignal(first, frames, .32f, -.25f);
    fxRequire(readPatch(first)["code"].toString() == code, "Failed compilation replaced saved source");

    restore(second, saved);
    checkSignal(second, frames, .32f, -.25f);
    const auto restored = readPatch(second);
    fxRequire(restored["name"].toString() == "Stereo host probe" && restored["code"].toString() == code,
              "FX patch identity lost on restore");
    fxRequire(std::abs(static_cast<double>(restored["values"][address]) - .32) < .0001,
              "FX slider lost on restore");
}
}
