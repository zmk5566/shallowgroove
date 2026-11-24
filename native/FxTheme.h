#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "FxPalette.h"

class FxTheme final : public juce::LookAndFeel_V4 {
public:
 FxTheme(){
  setDefaultSansSerifTypefaceName(juce::Font::getDefaultMonospacedFontName());
  setColour(juce::TextButton::buttonColourId,studio::panel);
  setColour(juce::TextButton::textColourOffId,studio::ink);
  setColour(juce::Label::textColourId,studio::ink);
  setColour(juce::TextEditor::backgroundColourId,studio::bg);
  setColour(juce::TextEditor::textColourId,studio::ink);
  setColour(juce::TextEditor::highlightColourId,studio::signal.withAlpha(.35f));
  setColour(juce::TextEditor::outlineColourId,studio::line);
  setColour(juce::TextEditor::focusedOutlineColourId,studio::signal);
  setColour(juce::ComboBox::textColourId,studio::ink);
  setColour(juce::PopupMenu::backgroundColourId,studio::panel);
  setColour(juce::PopupMenu::textColourId,studio::ink);
  setColour(juce::PopupMenu::highlightedBackgroundColourId,studio::signal);
  setColour(juce::PopupMenu::highlightedTextColourId,studio::bg);
  setColour(juce::Slider::textBoxTextColourId,studio::ink);
  setColour(juce::Slider::textBoxOutlineColourId,studio::line);
  setColour(juce::ScrollBar::thumbColourId,studio::muted);
 }
 void drawButtonBackground(juce::Graphics& g,juce::Button& b,const juce::Colour& colour,bool hover,bool down) override {
  g.fillAll(down?colour.darker(.15f):hover?colour.brighter(.1f):colour);
  g.setColour(hover?studio::ink:studio::line);g.drawRect(b.getLocalBounds());
 }
 void drawComboBox(juce::Graphics& g,int w,int h,bool,int,int,int,int,juce::ComboBox&) override {
  g.fillAll(studio::bg);g.setColour(studio::line);g.drawRect(0,0,w,h);
  juce::Path arrow;arrow.addTriangle(w-17,h*.45f,w-9,h*.45f,w-13,h*.62f);g.setColour(studio::muted);g.fillPath(arrow);
 }
 void drawLinearSlider(juce::Graphics& g,int x,int y,int w,int h,float pos,float,float,juce::Slider::SliderStyle,juce::Slider&) override {
  g.setColour(studio::line);g.fillRect(x,y+h/2-1,w,2);
  g.setColour(studio::ink);g.fillRect(int(pos)-3,y+h/2-5,7,10);
 }
 juce::Font getTextButtonFont(juce::TextButton&,int) override {return juce::FontOptions(13.f);}
 juce::Font getComboBoxFont(juce::ComboBox&) override {return juce::FontOptions(13.f);}
};
