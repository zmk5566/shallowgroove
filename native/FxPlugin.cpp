#include "RackJson.h"
#include <juce_audio_utils/juce_audio_utils.h>
#include "FxService.h"
#include "FxTheme.h"
#include <mutex>

namespace {
using namespace sg::wire;
String declaredName(const String& code) {
    juce::CodeDocument document;
    document.replaceAllContent(code);
    juce::CodeDocument::Iterator it(document);
    juce::CPlusPlusCodeTokeniser tokens;
    int stage=0;
    while(!it.isEOF()){
        it.skipWhitespace();
        const auto start=it.getPosition();
        const auto type=tokens.readNextToken(it);
        if(it.getPosition()==start)break;
        if(type==juce::CPlusPlusCodeTokeniser::tokenType_comment)continue;
        const auto token=code.substring(start,it.getPosition());
        if(stage==2&&type==juce::CPlusPlusCodeTokeniser::tokenType_string)
            return juce::JSON::fromString(token).toString().trim().substring(0,200);
        stage=token=="declare"?1:stage==1&&token=="name"?2:0;
    }
    return {};
}
struct Patch {
    String name="Stereo Gain", code="declare name \"Stereo Gain\";\ngain = hslider(\"Gain\", 1, 0, 2, 0.01);\nprocess = *(gain), *(gain);\n", kind="custom";
    sg::Values settings;
    var previous;
};
var encode(const Patch& patch) {
    auto result=object();
    put(result,"format","shallowgroove-fx-v1"); put(result,"name",patch.name); put(result,"code",patch.code);
    put(result,"kind",patch.kind); put(result,"values",json(patch.settings));
    if (patch.previous.isObject()) put(result,"previous",patch.previous);
    return result;
}
Patch decode(const var& state) {
    Patch patch;
    patch.name=String(text(state,"name")); patch.code=String(text(state,"code"));
    patch.kind=state.getProperty("kind","custom").toString();
    patch.settings=values(state["values"]); patch.previous=state["previous"];
    return patch;
}
var reference(const var& entry) {
    if (!entry["id"].isString() || entry["id"].toString().startsWith("factory:")) return {};
    auto ref=object();
    for (auto key : {"name","id","revision"}) put(ref,key,entry[key]);
    return ref;
}

class FxProcessor final : public juce::AudioProcessor {
public:
    FxProcessor() : AudioProcessor(BusesProperties().withInput("Input",juce::AudioChannelSet::stereo(),true)
        .withOutput("Output",juce::AudioChannelSet::stereo(),true)) {}
    const String getName() const override { return "ShallowGroove FX"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 5; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const String getProgramName(int) override { return {}; }
    void changeProgramName(int,const String&) override {}
    bool isBusesLayoutSupported(const BusesLayout& layout) const override {
        return layout.getMainInputChannelSet()==juce::AudioChannelSet::stereo()
            && layout.getMainOutputChannelSet()==juce::AudioChannelSet::stereo();
    }
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;
    void prepareToPlay(double rate,int) override {
        std::lock_guard guard(control); sampleRate=rate;
        try { install(current,false); } catch (const std::exception& error) { issue=error.what(); }
    }
    void releaseResources() override { core.reset(); }
    void processBlock(juce::AudioBuffer<float>& audio,juce::MidiBuffer&) override {
        juce::ScopedNoDenormals protect;
        if (audio.getNumChannels()<2 || !ready.load()) return;
        auto* left=audio.getWritePointer(0); auto* right=audio.getWritePointer(1);
        core.render(left,right,audio.getNumSamples(),{},{},left,right);
    }
    void apply(Patch patch) { std::lock_guard guard(control); install(std::move(patch)); proposed={}; }
    bool propose(String code,uint64_t expected){
        std::lock_guard guard(control);
        if(revision.load()!=expected)return false;
        proposed=std::move(code);return true;
    }
    void discardProposal(){std::lock_guard guard(control);proposed={};}
    void applyProposal(const String& expected,const String& title){
        std::lock_guard guard(control);
        if(expected.isEmpty()||expected!=proposed)throw std::runtime_error("The draft changed. Review the current effect before applying.");
        auto patch=current;patch.code=proposed;patch.name=title;
        install(std::move(patch));proposed={};
    }
    struct Snapshot { Patch patch; std::vector<sg::Parameter> parameters; uint64_t revision; String issue,proposed; };
    Snapshot snapshot() {
        std::lock_guard guard(control);
        return {current,core.parameters(),revision.load(),issue,proposed};
    }
    void change(const sg::Parameter& p,float value) {
        std::lock_guard guard(control);
        if (core.setParameter(p.device,p.address,value)) current.settings[p.address]=value;
    }
    void linkSaved(const var& entry) { std::lock_guard guard(control); current.previous=reference(entry); current.name=entry["name"].toString(); }
    void getStateInformation(juce::MemoryBlock& out) override {
        std::lock_guard guard(control);
        auto state=encode(current); put(state,"conversationScope",conversationScope);put(state,"thread",thread);
        auto encoded=juce::JSON::toString(state,true);
        out.replaceAll(encoded.toRawUTF8(),encoded.getNumBytesAsUTF8());
    }
    void setStateInformation(const void* input,int size) override {
        if (!input || size<1 || size>4*1024*1024) return;
        auto state=juce::JSON::parse(String::fromUTF8(static_cast<const char*>(input),size));
        if (state["format"].toString()!="shallowgroove-fx-v1") return;
        std::lock_guard guard(control);
        try {
            auto restored=decode(state);
            const bool sameSource=restored.code==current.code&&restored.name==current.name
                &&state["conversationScope"].toString()==conversationScope
                &&restored.previous["id"]==current.previous["id"];
            install(std::move(restored));
            if(!sameSource)proposed={};
            thread=state["thread"];
            if(state["conversationScope"].isString())conversationScope=state["conversationScope"].toString();
        } catch (const std::exception& error) { issue=error.what(); }
    }
    var remembered(){std::lock_guard guard(control);return thread;}
    void remember(var value){std::lock_guard guard(control);thread=std::move(value);}
    String scope(){std::lock_guard guard(control);return conversationScope;}
    std::atomic<uint64_t> revision{0};
private:
    var thread;
    String conversationScope="vst:"+juce::Uuid().toString();
    sg::Core core;
    std::mutex control;
    double sampleRate=48000;
    std::atomic<bool> ready{false};
    Patch current;
    String issue,proposed;
    void install(Patch patch,bool changed=true) {
        if (patch.name.trim().isEmpty() || patch.name.length()>200)
            throw std::runtime_error("Enter a name of 1 to 200 characters.");
        sg::Rack rack;
        rack.effects.push_back({"effect",patch.code.toStdString(),patch.settings});
        core.load(rack,sampleRate);
        sg::Values resolved;
        for (const auto& p : core.parameters()) {
            auto it=patch.settings.find(p.address);
            if (it==patch.settings.end()) it=patch.settings.find(p.label);
            resolved[p.address]=it==patch.settings.end()?p.init:std::clamp(it->second,p.min,p.max);
        }
        patch.settings=std::move(resolved);
        current=std::move(patch); issue.clear(); ready.store(true); if(changed)++revision;
    }
};

// Restrict the native bridge to the local Assistant page for this editor.
class AssistantBrowser final : public juce::WebBrowserComponent {
public:
    AssistantBrowser(const Options& options,String url):WebBrowserComponent(options),page(std::move(url)){}
    bool pageAboutToLoad(const String& url) override {return url==page||url=="about:blank";}
    const String page;
};

class FxEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit FxEditor(FxProcessor& owner) : AudioProcessorEditor(owner), processor(owner) {
        for (juce::Component* c : std::initializer_list<juce::Component*>{&name,&source,&library,&refresh,&apply,&save,&copy,&status,&viewport,&dsp,&applyEdit,&retry})
            addAndMakeVisible(c);
        dsp.setClickingTogglesState(true);
        dsp.onClick=[this]{resized();};
        applyEdit.onClick=[this]{
            applyDraft(true);
        };
        source.setMultiLine(true);
        source.setReturnKeyStartsNewLine(true);
        source.setFont(juce::Font(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(),15,juce::Font::plain)));
        name.setTextToShowWhenEmpty("Effect name",juce::Colours::grey);
        retry.onClick=[this]{openPanel();};
        library.setTextWhenNothingSelected("Effect library");
        viewport.setViewedComponent(&panel,false);
        viewport.setScrollBarsShown(true,false);
        refresh.onClick=[this] { list(); };
        name.onTextChange=[this] { ++generation; };
        source.onTextChange=[this]{processor.discardProposal();++generation;applyEdit.setVisible(false);resized();};
        library.onChange=[this] { loadEntry(); };
        apply.onClick=[this] { applyDraft(); };
        save.onClick=[this] { beginSave(false); };
        copy.onClick=[this] { beginSave(true); };
        setLookAndFeel(&theme);
        for(auto* heading:{&brand,&codeTitle,&paramsTitle}){
            addAndMakeVisible(heading);
            heading->setFont(juce::FontOptions(13.f,juce::Font::bold));
            heading->setColour(juce::Label::textColourId,studio::ink);
        }
        brand.setText("ShallowGroove FX",juce::dontSendNotification);
        brand.setFont(juce::FontOptions(16.f,juce::Font::bold));
        codeTitle.setText("Faust",juce::dontSendNotification);
        paramsTitle.setText("Parameters",juce::dontSendNotification);
        status.setColour(juce::Label::textColourId,studio::muted);
        apply.setColour(juce::TextButton::buttonColourId,studio::signal);
        apply.setColour(juce::TextButton::textColourOffId,studio::bg);
        name.setFont(juce::FontOptions(14.f));
        setResizable(true,true); setResizeLimits(630,410,1400,1100); setSize(920,560);
        applyEdit.setVisible(false);
        sync(); startTimerHz(5); list();openPanel();
    }
    ~FxEditor() override {setLookAndFeel(nullptr);}
    void paint(juce::Graphics& g) override {
        g.fillAll(studio::bg);
        for(const auto& area:{effectsPanel,chatPanel}){
            g.setColour(studio::surface);g.fillRect(area);
            g.setColour(studio::line);g.drawRect(area);
            g.drawHorizontalLine(area.getY()+39,float(area.getX()),float(area.getRight()));
        }
    }
    void resized() override {
        auto area=getLocalBounds().reduced(8);
        chatPanel=area.removeFromRight(juce::jlimit(222,460,area.getWidth()*36/100));
        area.removeFromRight(8);effectsPanel=area;
        auto effects=effectsPanel.reduced(9);
        auto top=effects.removeFromTop(25);
        dsp.setBounds(top.removeFromRight(56));
        brand.setBounds(top);effects.removeFromTop(14);
        auto pick=effects.removeFromTop(27);
        refresh.setBounds(pick.removeFromRight(68));pick.removeFromRight(4);library.setBounds(pick);
        effects.removeFromTop(7);name.setBounds(effects.removeFromTop(28));
        effects.removeFromTop(7);
        status.setBounds(effects.removeFromBottom(30));
        auto actions=effects.removeFromBottom(27);
        const bool showCode=dsp.getToggleState();
        for(auto* c:{static_cast<juce::Component*>(&source),static_cast<juce::Component*>(&apply),static_cast<juce::Component*>(&codeTitle)})c->setVisible(showCode);
        apply.setVisible(showCode);
        paramsTitle.setVisible(!showCode);viewport.setVisible(!showCode);
        dsp.setColour(juce::TextButton::textColourOnId,studio::signal);
        if(showCode){apply.setBounds(actions.removeFromLeft(juce::jmin(125,actions.getWidth()/3)));actions.removeFromLeft(4);}
        save.setBounds(actions.removeFromLeft(110));actions.removeFromLeft(4);copy.setBounds(actions.removeFromLeft(90));
        effects.removeFromBottom(6);
        auto heading=effects.removeFromTop(24);
        codeTitle.setBounds(heading);paramsTitle.setBounds(heading);
        source.setBounds(effects);viewport.setBounds(effects);layoutKnobs();

        auto chat=chatPanel.reduced(1);
        if(applyEdit.isVisible())applyEdit.setBounds(chat.removeFromBottom(30));
        retry.setBounds(chat.withSizeKeepingCentre(145,32));
        if(browser)browser->setBounds(chat);
    }
private:
    FxTheme theme;
    juce::Label brand,codeTitle,paramsTitle;
    juce::TextButton dsp{"DSP"},applyEdit{"Apply edit"};
    juce::TextButton retry{"Connect Assistant"};
    std::unique_ptr<AssistantBrowser> browser;
    sg::FxService panelService;
    juce::Rectangle<int> effectsPanel,chatPanel;
    FxProcessor& processor;
    juce::TextEditor name,source;
    std::unique_ptr<juce::AlertWindow> saveDialog;
    juce::ComboBox library;
    juce::TextButton refresh{"Refresh"},apply{"Compile & apply"},save{"Save to library"},copy{"Save a copy"};
    juce::Label status;
    juce::Component panel;
    juce::Viewport viewport;
    juce::OwnedArray<juce::Label> labels;
    juce::OwnedArray<juce::Slider> knobs;
    juce::Array<var> entries;
    uint64_t seen=0,generation=0;
    sg::FxService service;

    void message(String s) { status.setText(s,juce::dontSendNotification); status.setTooltip(s); }
    void timerCallback() override { if(seen!=processor.revision.load()) sync(); }
    void sync() {
        auto state=processor.snapshot();
        seen=state.revision; ++generation;
        applyEdit.setVisible(state.proposed.isNotEmpty());resized();
        name.setText(state.patch.name,false); source.setText(state.proposed.isNotEmpty()?state.proposed:state.patch.code,false);
        const auto selected=library.getSelectedId()-1;
        if(juce::isPositiveAndBelow(selected,entries.size())&&entries[selected]["code"].toString()!=state.patch.code)
            library.setSelectedId(0,juce::dontSendNotification);
        labels.clear(); knobs.clear();
        for (const auto& p : state.parameters) {
            auto* label=labels.add(new juce::Label());
            label->setText(String(p.label),juce::dontSendNotification); panel.addAndMakeVisible(label);
            auto* knob=knobs.add(new juce::Slider());
            knob->setSliderStyle(juce::Slider::LinearHorizontal);
            knob->setTextBoxStyle(juce::Slider::TextBoxRight,false,64,20);
            if(p.max>p.min) knob->setRange(p.min,p.max,std::max(0.f,p.step));
            knob->setValue(state.patch.settings.at(p.address),juce::dontSendNotification);
            knob->setName(String(p.label));
            knob->onValueChange=[this,knob,p] {
                processor.change(p,float(knob->getValue())); ++generation; notifyHost();
            };
            panel.addAndMakeVisible(knob);
        }
        layoutKnobs();
        if(state.issue.isNotEmpty()) message(state.issue);
    }
    void notifyHost() { processor.updateHostDisplay(juce::AudioProcessorListener::ChangeDetails().withNonParameterStateChanged(true)); }
    void layoutKnobs() {
        panel.setSize(std::max(1,viewport.getWidth()-16),knobs.size()*53);
        for(int i=0;i<knobs.size();++i) {
            labels[i]->setBounds(2,i*53,panel.getWidth()-2,22);
            knobs[i]->setBounds(3,i*53+22,panel.getWidth()-5,24);
        }
    }
    bool install(Patch patch) {
        try { processor.apply(std::move(patch)); sync(); notifyHost(); message("Effect applied."); return true; }
        catch(const std::exception& error) { message(error.what()); return false; }
    }
    bool applyDraft(bool assistant=false) {
        auto patch=processor.snapshot().patch;
        const auto newCode=source.getText();
        auto title=name.getText().trim();
        if(newCode!=patch.code){
            const auto newTitle=declaredName(newCode);
            if(newTitle.isNotEmpty()&&(assistant||newTitle!=declaredName(patch.code)))title=newTitle;
        }
        if(assistant){
            try{processor.applyProposal(newCode,title);sync();notifyHost();message("Applied: "+title);return true;}
            catch(const std::exception& error){message(error.what());return false;}
        }
        patch.name=title; patch.code=newCode;
        return install(std::move(patch));
    }
    void request(var payload,bool draftSensitive,std::function<void(FxEditor&,var)> complete) {
        for(auto* b:{&refresh,&save,&copy}) b->setEnabled(false);
        const auto token=generation,revision=seen;
        service.request(payload,[self=juce::Component::SafePointer<FxEditor>(this),token,revision,draftSensitive,complete=std::move(complete)](var reply) {
            if (!self) return;
            for(auto* b:{&self->refresh,&self->save,&self->copy}) b->setEnabled(true);
            if(draftSensitive && (token!=self->generation || revision!=self->processor.revision.load())) {
                self->message("The patch changed while the request was running.");
                return;
            }
            if(!bool(reply["ok"])) { self->message(reply["error"].toString()); return; }
            complete(*self,reply);
        });
    }
    String selectedLibraryId() const {
        const int index=library.getSelectedId()-1;
        return juce::isPositiveAndBelow(index,entries.size())?entries[index]["id"].toString():String();
    }
    void rebuildLibraryMenu(const String& selected){
        library.clear(juce::dontSendNotification);
        juce::PopupMenu user,system;
        int selectedItem=0;
        for(int i=0;i<entries.size();++i){
            const auto& entry=entries[i];
            const auto id=entry["id"].toString();
            auto& menu=id.startsWith("factory:")?system:user;
            menu.addItem(i+1,libraryLabel(entry));
            if(id==selected)selectedItem=i+1;
        }
        auto* root=library.getRootMenu();
        root->addSubMenu("User Library",user,user.getNumItems()>0);
        root->addSubMenu("System",system,system.getNumItems()>0);
        library.setSelectedId(selectedItem,juce::dontSendNotification);
    }
    void list() {
        auto payload=object(); put(payload,"op","list"); message("Loading effect library…");
        request(payload,false,[](FxEditor& self,var reply) {
            auto selected=self.selectedLibraryId();
            const auto active=self.processor.snapshot().patch;
            self.entries.clear();
            if(auto* items=reply["entries"].getArray())for(const auto& entry:*items)
                if(entry["kind"].toString()!="instrument")self.entries.add(entry);
            if(selected.isEmpty())for(const auto& entry:self.entries)
                if(entry["id"]==active.previous["id"]&&entry["code"].toString()==active.code)selected=entry["id"].toString();
            self.rebuildLibraryMenu(selected);
            self.message(String(self.entries.size())+" library effects.");
        });
    }
    void loadEntry() {
        auto index=library.getSelectedId()-1;
        if(!juce::isPositiveAndBelow(index,entries.size())) return;
        try {
            auto entry=entries[index];
            auto patch=decode(entry); patch.previous=reference(entry);
            install(std::move(patch));
        } catch(const std::exception& error) { message(error.what()); }
    }
    static String libraryLabel(const var& entry){
        if(entry["id"].toString().startsWith("factory:"))return entry["name"].toString();
        return entry["name"].toString()+"  (v"+entry["revision"].toString()+")";
    }
    void beginSave(bool copyEntry){
        const auto declared=declaredName(source.getText());
        askPresetName(declared.isNotEmpty()?declared:name.getText().trim(),copyEntry,false);
    }
    void askPresetName(String suggested,bool savingCopy,bool duplicate){
        const bool revision=!savingCopy&&processor.snapshot().patch.previous.isObject();
        const String description=duplicate
            ?(revision?"Another preset has this name. Save a revision of the current preset with this name?":"A preset already has this name. Save another preset with this name?")
            :(revision?"Name this revision.":"Name your preset.");
        saveDialog=std::make_unique<juce::AlertWindow>("Save to User Library",description,juce::MessageBoxIconType::NoIcon,this);
        auto& dialog=*saveDialog;
        dialog.addTextEditor("name",suggested,"Preset name");
        auto* field=dialog.getTextEditor("name");
        field->setInputRestrictions(200);
        dialog.addButton(duplicate?"Confirm save":"Save",1,juce::KeyPress(juce::KeyPress::returnKey));
        dialog.addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));
        const auto version=processor.revision.load();
        dialog.enterModalState(true,juce::ModalCallbackFunction::create([self=juce::Component::SafePointer<FxEditor>(this),version,savingCopy,duplicate,suggested](int result){
            if(!self||!self->saveDialog)return;
            const auto title=self->saveDialog->getTextEditorContents("name").trim();
            self->saveDialog.reset();
            if(result!=1)return;
            if(version!=self->processor.revision.load()){self->message("Effect changed. Open Save again.");return;}
            if(title.isEmpty()){self->askPresetName({},savingCopy,false);return;}
            self->savePatch(title,savingCopy,duplicate&&title==suggested);
        }),false);
        field->grabKeyboardFocus();field->selectAll();
    }
    void savePatch(const String& title,bool savingCopy,bool confirmed){
        auto patch=processor.snapshot().patch;
        if(source.getText()!=patch.code){
            if(!dsp.getToggleState()){
                message("Apply the edit before saving it to the library.");return;
            }
            if(!applyDraft())return;
            patch=processor.snapshot().patch;
        }
        auto payload=encode(patch);
        if(savingCopy)payload.getDynamicObject()->removeProperty("previous");
        put(payload,"name",title);put(payload,"op","save");
        put(payload,"checkName",true);
        if(confirmed)put(payload,"confirmedName",title);
        message("Saving effect…");
        const auto revision=processor.revision.load();
        request(payload,false,[revision,title,savingCopy](FxEditor& self,var reply){
            if(bool(reply["duplicate"])){
                self.message("Preset name already exists.");
                if(self.processor.revision.load()==revision)self.askPresetName(title,savingCopy,true);
                return;
            }
            const auto entry=reply["entry"];
            int index=0;
            while(index<self.entries.size()&&self.entries[index]["id"]!=entry["id"])++index;
            auto selected=self.selectedLibraryId();
            if(index==self.entries.size())self.entries.add(entry);
            else self.entries.set(index,entry);
            if(self.processor.revision.load()==revision){
                self.processor.linkSaved(entry);self.name.setText(entry["name"].toString(),false);
                selected=entry["id"].toString();self.notifyHost();
            }
            self.rebuildLibraryMenu(selected);
            self.message("Saved to User Library: "+libraryLabel(entry));
        });
    }
    var handlePanel(const var& command){
        auto snapshot=processor.snapshot();
        auto patch=encode(snapshot.patch);
        const String version=String(generation)+"-"+String(snapshot.revision);
        auto action=command["action"].toString();
        if(action=="remember"){
            auto ref=object();put(ref,"scope",command["scope"]);put(ref,"id",command["id"]);
            if(juce::JSON::toString(ref)!=juce::JSON::toString(processor.remembered())){processor.remember(ref);notifyHost();}
            return {};
        }
        if(action=="inspect"){
            put(patch,"thread",processor.remembered());
            put(patch,"scope",processor.scope());put(patch,"generation",version);
            put(patch,"draftCode",source.getText());
            juce::Array<var> controls;
            for(auto& p:snapshot.parameters){
                auto c=object();put(c,"address",String(p.address));put(c,"label",String(p.label));
                put(c,"min",p.min);put(c,"max",p.max);controls.add(c);
            }
            put(patch,"controls",controls);return patch;
        }
        auto result=object();
        if(command["generation"].toString()!=version){put(result,"error","Effect changed. Inspect it before editing.");return result;}
        if(action=="search_effect_library"){
            juce::Array<var> matches;
            for(auto& e:entries){
                const auto src=e["id"].toString().startsWith("factory:")?"factory":"user";
                if(command["source"].isString()&&command["source"].toString()!=src)continue;
                if(!(e["name"].toString()+" "+e["kind"].toString()).containsIgnoreCase(command["query"].toString()))continue;
                auto item=reference(e);if(!item.isObject())item=object();
                for(auto key:{"id","revision","name","kind"})put(item,key,e[key]);
                put(item,"source",src);matches.add(item);
            }
            put(result,"entries",matches);return result;
        }
        if(action=="set_parameter"){
            for(auto& p:snapshot.parameters)if(command["address"].toString()==String(p.address)||command["address"].toString().equalsIgnoreCase(String(p.label))){
                const double value=command["value"];
                if(!command.hasProperty("value")||!std::isfinite(value)||value<p.min||value>p.max)break;
                processor.change(p,float(value));++generation;notifyHost();
                for(int i=0;i<labels.size();++i)if(labels[i]->getText()==String(p.label))knobs[i]->setValue(value,juce::dontSendNotification);
                put(result,"value",value);return result;
            }
            put(result,"error","Unknown parameter or invalid value.");return result;
        }
        if(action=="load_library_effect"){
            for(auto& e:entries)if(e["id"]==command["entryId"]&&int(e["revision"])==int(command["entryRevision"])){
                auto patchToLoad=decode(e);patchToLoad.previous=reference(e);
                if(!install(std::move(patchToLoad)))put(result,"error",status.getText());else put(result,"applied",true);
                return result;
            }
            put(result,"error","Library entry or revision is unavailable.");return result;
        }
        if(action=="replace_patch"&&command["code"].isString()&&command["code"].toString().length()<=60000){
            const auto code=command["code"].toString();
            if(code.isEmpty()||!processor.propose(code,snapshot.revision)){put(result,"error","Effect changed or draft is empty.");return result;}
            source.setText(code,false);++generation;
            applyEdit.setVisible(true);resized();put(result,"pendingAudition",true);return result;
        }
        put(result,"error","This operation is unavailable in a VST effect.");return result;
    }
    void openPanel(){
        retry.setEnabled(false);
        auto request=object();put(request,"op","panel");
        panelService.request(request,[self=juce::Component::SafePointer<FxEditor>(this)](var reply){
            if(!self)return;
            self->retry.setEnabled(true);
            const auto origin=reply["origin"].toString();
            const auto port=origin.fromFirstOccurrenceOf("http://127.0.0.1:",false,false);
            if(!bool(reply["ok"])||!origin.startsWith("http://127.0.0.1:")||!port.containsOnly("0123456789")||port.getIntValue()<=0||port.getIntValue()>65535){
                self->message(reply["error"].toString());return;
            }
            auto options=juce::WebBrowserComponent::Options().withNativeIntegrationEnabled()
                .withNativeFunction("fxCommand",[self](const juce::Array<var>& args,auto done){
                    done(self&&!args.isEmpty()?self->handlePanel(args[0]):var());
                });
           #if JUCE_WINDOWS
            options=options.withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2().withUserDataFolder(
                    juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("ShallowGroove/WebView2")));
           #endif
            const auto url=origin+"/?fx-assistant="+(reply["locale"].toString()=="en"?String("en"):String("zh-CN"));
            self->browser=std::make_unique<AssistantBrowser>(options,url);
            self->addAndMakeVisible(*self->browser);self->retry.setVisible(false);
            self->resized();self->browser->goToURL(url);
        });
    }

};
juce::AudioProcessorEditor* FxProcessor::createEditor() { return new FxEditor(*this); }
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new FxProcessor(); }
