#!/usr/bin/env python3
"""Turns the Sobo source (mascot/sobo, pulled from Rive with `rive create --from-remote-file`)
into the game's talking host: natural lip-sync mouth shapes with teeth, and a small export.

What it changes in mascot/sobo/scene.rml (run once on a freshly pulled source):
  * A `viseme` number on the view model drives nine mouth poses on SOBO-Motion-V02:
      0 rest · 1 M/B/P · 2 EE/S/T · 3 EH · 4 AH · 5 OH · 6 OO/W · 7 F/V · 8 L
    Each pose reshapes the mouth's four vertices, shows or hides upper/lower teeth
    (new shapes clipped inside the mouth like the tongue) and moves the tongue. The
    old open/closed MOUTH layer is replaced by one that blends between poses in 60ms.
  * Only SOBO-Motion-V02 is exported, and the reference images/fonts are left out,
    so the game's .riv stays small.

Then build and copy:  rive mascot/sobo --once && cp mascot/sobo/build/sobo.riv src/assets/mascot/sobo.riv
"""
import re
import sys
from pathlib import Path

SCENE = Path(__file__).parent / "sobo" / "scene.rml"
ARTBOARD = "SOBO-Motion-V02"
VIEW_MODEL, MOUTH_LAYER, MOUTH_NODE, TONGUE, STROKE = "0:14", "0:31521", "0:25498", "0:25499", "0:25519"
LEFT, TOP, RIGHT, BOTTOM, MOUTH_SHAPE = "0:25515", "0:25516", "0:25517", "0:25518", "0:25513"
VISEME_PROP, VISEME_VALUE = "0:70000", "0:70001"
TEETH_UPPER, TEETH_LOWER = "0:70011", "0:70013"

# Poses in the mouth's own coordinates (the original open mouth spans x -26..27, y -14..20).
# left/right: corner x, corner y, handle angle (radians), in/out handle length
# top/bottom: y and handle length; stroke: outline thickness (closed lips are drawn by it)
# teeth: (y, opacity) for the upper and lower rows; tongue: its node's y (21 is resting low)
CLOSED_LEFT = (-17.5, -3.1449585, 3.6052403, 1.118034, 1.0645086)
CLOSED_RIGHT = (18.5, -3.1449585, 2.6779451, 0.81602252, 1.118034)
def open_pose(left, right, y, angle, handle, top, top_d, bottom, bottom_d, upper, lower, tongue):
    return dict(left=(left, y, -angle, handle, handle), right=(right, y, angle, handle, handle), top=(top, top_d),
                bottom=(bottom, bottom_d), stroke=0, upper=upper, lower=lower, tongue=tongue)
POSES = [
    # 0 rest: the original closed smile.
    dict(left=CLOSED_LEFT, right=CLOSED_RIGHT, top=(0.8550415, 11.5), bottom=(0.8550415, 10.5), stroke=6, upper=(-6, 0), lower=(6, 0), tongue=21),
    # 1 M/B/P: lips pressed, a little narrower and flatter.
    dict(left=(-15.5, 0.8, 3.1415927, 1.0, 1.0), right=(16.5, 0.8, 0, 1.0, 1.0), top=(0.8, 9.5), bottom=(0.8, 9), stroke=7, upper=(-6, 0), lower=(6, 0), tongue=21),
    # 2 EE/S/T/K: wide, barely open, both rows of teeth showing.
    open_pose(-23, 24, -4, 1.3, 3, -6.5, 10, 5, 14, (-4.9, 1), (4.8, 1), 24),
    # 3 EH/AE: open, upper teeth, tongue low.
    open_pose(-23, 24, -5, 1.0768549, 5.5, -10, 10, 13, 19, (-6, 1), (10, 0), 21),
    # 4 AH: wide open, upper teeth, tongue low.
    open_pose(-26.5, 27.5, -6.5, 1.0768549, 7, -14, 11.5, 23, 24.5, (-10, 1), (12, 0), 22),
    # 5 OH/ER: rounded and narrower.
    open_pose(-16, 17, -2.5, 1.45, 8, -11, 9, 14, 11, (-7, 0), (10, 0), 21),
    # 6 OO/W: small puckered circle.
    open_pose(-11.5, 12.5, 0.5, 1.5707964, 6, -7.5, 6.5, 9, 6.5, (-4, 0), (4, 0), 24),
    # 7 F/V: upper teeth resting on the lower lip.
    open_pose(-21, 22, -3, 1.25, 4, -8.5, 10, 3.5, 12, (-3.6, 1), (6, 0), 28),
    # 8 L: open with the tongue raised behind the teeth.
    open_pose(-22, 23, -5, 1.0768549, 5.5, -10, 10, 12, 18, (-6, 1), (10, 0), 9),
]
NAMES = ["Viseme Rest", "Viseme MBP", "Viseme EE", "Viseme EH", "Viseme AH", "Viseme OH", "Viseme OO", "Viseme FV", "Viseme L"]
ANIM_ID = lambda i: f"0:{70100 + i}"
STATE_ID = lambda i: f"0:{70200 + i}"

def keyed(object_id, values):
    props = "".join(f'<KeyedProperty propertyKey="{key}"><KeyFrameDouble value="{value}" frame="0" interpolationType="linear"/></KeyedProperty>'
                    for key, value in values)
    return f'<KeyedObject objectId="{object_id}">{props}</KeyedObject>'

def animation(index, pose):
    lx, ly, lr, li, lo = pose["left"]; rx, ry, rr, ri, ro = pose["right"]
    parts = [
        keyed(LEFT, [(24, lx), (25, ly), (79, lr), (80, li), (81, lo)]),
        keyed(TOP, [(25, pose["top"][0]), (83, pose["top"][1])]),
        keyed(RIGHT, [(24, rx), (25, ry), (79, rr), (80, ri), (81, ro)]),
        keyed(BOTTOM, [(25, pose["bottom"][0]), (83, pose["bottom"][1])]),
        keyed(STROKE, [(47, pose["stroke"])]),
        keyed(TEETH_UPPER, [(14, pose["upper"][0]), (18, pose["upper"][1])]),
        keyed(TEETH_LOWER, [(14, pose["lower"][0]), (18, pose["lower"][1])]),
        keyed(TONGUE, [(14, pose["tongue"])]),
    ]
    return f'        <LinearAnimation duration="1" name="{NAMES[index]}" id="{ANIM_ID(index)}">\n            ' + "\n            ".join(parts) + "\n        </LinearAnimation>\n"

def condition(value):
    compare = f' value="{value}"' if value else ""
    return (f'<TransitionViewModelCondition><TransitionPropertyViewModelComparator><BindablePropertyNumber>'
            f'<DataBindContext sourcePathIds="{VIEW_MODEL}-{VISEME_PROP}" propertyKey="636"/></BindablePropertyNumber>'
            f'</TransitionPropertyViewModelComparator><TransitionValueNumberComparator{compare}/></TransitionViewModelCondition>')

def mouth_layer():
    states = []
    for index in range(len(POSES)):
        transitions = "".join(f'\n                    <StateTransition stateToId="{STATE_ID(target)}" duration="60" interpolationType="2">{condition(target)}<CubicEaseInterpolator/></StateTransition>'
                              for target in range(len(POSES)) if target != index)
        states.append(f'                <AnimationState animationId="{ANIM_ID(index)}" x="{-200 + 160 * index}" y="{120 if index % 2 else -160}" id="{STATE_ID(index)}">{transitions}\n                </AnimationState>')
    return (f'            <StateMachineLayer name="MOUTH" id="{MOUTH_LAYER}">\n'
            f'                <AnyState x="-273" y="-43" id="0:31522"/>\n                <ExitState x="1300" y="-50" id="0:31523"/>\n'
            f'                <EntryState x="-144" y="-44" id="0:31524">\n                    <StateTransition stateToId="{STATE_ID(0)}" id="0:31552"/>\n                </EntryState>\n'
            + "\n".join(states) + "\n            </StateMachineLayer>")

TEETH = f'''<Node name="Teeth" id="0:70010">
                                    <Shape y="-6" opacity="0" name="Teeth.Upper" id="{TEETH_UPPER}">
                                        <Rectangle width="46" height="9" cornerRadiusTL="3.5" name="Path" id="0:70012"/>
                                        <Fill name="Fill 1"><SolidColor colorValue="FFFFFBF2" name="Component"/></Fill>
                                    </Shape>
                                    <Shape y="6" opacity="0" name="Teeth.Lower" id="{TEETH_LOWER}">
                                        <Rectangle width="40" height="8" cornerRadiusTL="3.5" name="Path" id="0:70014"/>
                                        <Fill name="Fill 1"><SolidColor colorValue="FFF6EEDF" name="Component"/></Fill>
                                    </Shape>
                                    <ClippingShape sourceId="{MOUTH_SHAPE}"/>
                                </Node>
                                '''

def main():
    text = SCENE.read_text()
    if VISEME_PROP in text:
        sys.exit("Already applied: pull a fresh source (rive pull mascot/sobo) before running again.")
    # 1. View model: the viseme number.
    text = text.replace('<ViewModelPropertyNumber name="mouthOpen" id="0:31525"/>',
                        f'<ViewModelPropertyNumber name="mouthOpen" id="0:31525"/>\n        <ViewModelPropertyNumber name="viseme" id="{VISEME_PROP}"/>', 1)
    text = text.replace('<ViewModelInstanceNumber viewModelPropertyId="0:31525" id="0:31526"/>',
                        f'<ViewModelInstanceNumber viewModelPropertyId="0:31525" id="0:31526"/>\n            <ViewModelInstanceNumber viewModelPropertyId="{VISEME_PROP}" id="{VISEME_VALUE}"/>', 1)
    # 2. Teeth, inside the mouth node, in front of the tongue.
    mouth = f'<Node x="4.9683884e-05" y="30" name="Mouth" id="{MOUTH_NODE}">\n                                '
    assert text.count(mouth) == 1, "mouth node not found"
    text = text.replace(mouth, mouth + TEETH, 1)
    # 3. Replace the open/closed MOUTH layer with the viseme layer.
    layer = re.compile(rf'            <StateMachineLayer name="MOUTH" id="{MOUTH_LAYER}">.*?</StateMachineLayer>', re.S)
    assert len(layer.findall(text)) == 1, "MOUTH layer not found"
    text = layer.sub(lambda _: mouth_layer(), text, count=1)
    # 4. The pose animations, at the end of the artboard.
    # The artboard itself, not a NestedArtboard elsewhere that shows it.
    start = re.search(rf'<Artboard [^>]*name="{ARTBOARD}"', text).start()
    end = text.index("    </Artboard>", start)
    text = text[:end] + "".join(animation(i, pose) for i, pose in enumerate(POSES)) + text[end:]
    # 5. Export only the game's artboard, without the reference images and fonts.
    # The artboard defaults to "State Machine Test", which has no MOUTH layer; the game
    # (and the CLI preview) should run "State Machine".
    machine = re.search(r'<StateMachine name="State Machine" id="([^"]+)"', text[start:end]).group(1)
    def artboard(match):
        tag = match.group(0)
        if f'name="{ARTBOARD}"' in tag:
            return re.sub(r'defaultStateMachineId="[^"]*"', f'defaultStateMachineId="{machine}"', tag)
        if 'includeInExport="false"' in tag:
            return tag
        return tag.replace("<Artboard ", '<Artboard includeInExport="false" ', 1)
    text = re.sub(r"<Artboard [^>]*>", artboard, text)
    text = re.sub(r"<(ImageAsset|FontAsset) ", r'<\1 exportFlags="2" ', text)
    SCENE.write_text(text)
    yaml = SCENE.parent / "rive.yaml"
    yaml.write_text(re.sub(r'main: "[^"]*"', f'main: "{ARTBOARD}"', yaml.read_text()))
    print("Applied: viseme mouth on", ARTBOARD)

if __name__ == "__main__":
    main()
