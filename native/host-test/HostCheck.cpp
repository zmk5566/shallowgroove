#include <juce_audio_processors/juce_audio_processors.h>
#include "FxCheck.h"
#include <cmath>
#include <iostream>
#include <stdexcept>

static void require(bool success, const juce::String& reason) {
    if (!success) throw std::runtime_error(reason.toStdString());
}
int main(int argc, char** argv) {
    try {
        const bool checkFx = argc == 3 && juce::String(argv[1]) == "--fx";
        require(checkFx || argc == 2, "Usage: ShallowGrooveHostCheck [--fx] plugin.vst3");
        juce::ScopedJuceInitialiser_GUI gui;
        juce::VST3PluginFormat format;
        juce::OwnedArray<juce::PluginDescription> types;
        format.findAllTypesForFile(types, juce::File::getCurrentWorkingDirectory().getChildFile(argv[argc - 1]).getFullPathName());
        require(types.size() == 1, "Expected one VST3 class");
        constexpr int rate = 48000, frames = 128;
        auto open = [&] {
            juce::String error;
            auto instance = format.createInstanceFromDescription(*types[0], rate, frames, error);
            require(instance != nullptr, error);
            instance->prepareToPlay(rate, frames);
            require(instance->getTotalNumOutputChannels() == 2, "Expected stereo output");
            return instance;
        };
        if (checkFx) {
            require(!types[0]->isInstrument, "FX scanned as an instrument");
            require(types[0]->category.containsIgnoreCase("Fx"), "Missing VST3 Fx category");
            auto first = open();
            require(first->getMainBusNumInputChannels() == 2 && first->getMainBusNumOutputChannels() == 2,
                    "FX did not open with stereo input and output");
            auto second = open();
            checkFxProcessing(*first, *second, frames);
            first->releaseResources();
            second->releaseResources();
            std::cout << types[0]->name << " VST3: stereo routing, Faust edits, control values,"
                      << " state restore, failed compile and instance isolation passed\n";
            return 0;
        }
        auto instance = open();
        auto audibleNote = [&](int pitch) {
            juce::AudioBuffer<float> buffer(2, frames);
            double energy = 0;
            for (int block = 0; block < 160; ++block) {
                juce::MidiBuffer midi;
                if (block == 0) midi.addEvent(juce::MidiMessage::noteOn(1, pitch, 0.8f), 32);
                if (block == 100) midi.addEvent(juce::MidiMessage::noteOff(1, pitch), 48);
                buffer.clear();
                instance->processBlock(buffer, midi);
                for (int ch = 0; ch < 2; ++ch) {
                    const auto* data = buffer.getReadPointer(ch);
                    for (int i = 0; i < frames; ++i) {
                        require(std::isfinite(data[i]), "Non-finite audio");
                        if (block == 0 && i < 32) require(std::abs(data[i]) < 1e-6f, "MIDI fired early");
                        energy += data[i] * data[i];
                    }
                }
            }
            require(energy > 0.0001, "Host received silence");
            return energy;
        };
        const auto initialEnergy = audibleNote(60);
        int macroIndex = -1;
        for (auto* param : instance->getParameters())
            if (param->getName(64).containsIgnoreCase("macro")) {macroIndex=param->getParameterIndex(); break;}
        require(macroIndex >= 0, "No host-visible macro");
        instance->getParameters()[macroIndex]->setValueNotifyingHost(.37f);
        juce::MemoryBlock state;
        instance->getStateInformation(state);
        require(state.getSize() > 0, "Empty plugin state");
        instance->releaseResources();
        instance.reset();
        instance = open();
        instance->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
        require(std::abs(instance->getParameters()[macroIndex]->getValue()-.37f)<.002f, "Macro lost on restore");
        const auto restoredEnergy = audibleNote(67);
        instance->releaseResources();
        std::cout << types[0]->name << " VST3, stereo, MIDI, state " << state.getSize()
                  << " bytes, energies " << initialEnergy << " and " << restoredEnergy << "\n";
    } catch (const std::exception& e) {std::cerr << e.what() << "\n"; return 1;}
    return 0;
}
