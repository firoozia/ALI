"""
Grasshopper file parser — supports .ghx (XML) and attempts binary .gh via embedded XML.
"""
import xml.etree.ElementTree as ET
import zipfile
import io
import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class GHParameter:
    name: str
    nickname: str
    type_hint: str = ""
    access: str = "Item"


@dataclass
class GHComponent:
    guid: str
    type_name: str
    nickname: str
    description: str
    category: str = ""
    subcategory: str = ""
    inputs: list[GHParameter] = field(default_factory=list)
    outputs: list[GHParameter] = field(default_factory=list)
    x: float = 0.0
    y: float = 0.0


@dataclass
class GHWire:
    from_component: str
    from_output: int
    to_component: str
    to_input: int


@dataclass
class GHGroup:
    nickname: str
    color: str = ""
    description: str = ""


@dataclass
class GHDefinition:
    components: list[GHComponent] = field(default_factory=list)
    wires: list[GHWire] = field(default_factory=list)
    groups: list[GHGroup] = field(default_factory=list)
    description: str = ""


def _text(el: Optional[ET.Element], tag: str, default: str = "") -> str:
    if el is None:
        return default
    found = el.find(f".//{tag}")
    return (found.text or default) if found is not None else default


def _find_chunk(el: ET.Element, name: str) -> Optional[ET.Element]:
    for chunk in el.findall("chunk"):
        if chunk.get("name") == name:
            return chunk
    return None


def _find_item(el: ET.Element, name: str) -> Optional[ET.Element]:
    for item in el.findall("items/item"):
        if item.get("name") == name:
            return item
    for item in el.findall("item"):
        if item.get("name") == name:
            return item
    return None


def _item_text(el: ET.Element, name: str, default: str = "") -> str:
    found = _find_item(el, name)
    return (found.text or default) if found is not None else default


def _parse_parameters(param_chunk: Optional[ET.Element]) -> list[GHParameter]:
    params = []
    if param_chunk is None:
        return params
    for obj in param_chunk.findall("chunk"):
        name = _item_text(obj, "Name", obj.get("name", ""))
        nickname = _item_text(obj, "NickName", name)
        type_hint = _item_text(obj, "TypeHintID", "")
        access = _item_text(obj, "Access", "Item")
        params.append(GHParameter(name=name, nickname=nickname, type_hint=type_hint, access=access))
    return params


def _parse_ghx_tree(root: ET.Element) -> GHDefinition:
    defn = GHDefinition()

    # Top-level definition properties
    defn_chunk = _find_chunk(root, "GrasshopperData")
    if defn_chunk is None:
        defn_chunk = root

    # Objects
    objects_chunk = _find_chunk(defn_chunk, "DefinitionObjects")
    if objects_chunk is None:
        return defn

    for obj_chunk in objects_chunk.findall("chunk"):
        if obj_chunk.get("name") != "Object":
            continue

        container = _find_chunk(obj_chunk, "Container")
        if container is None:
            container = obj_chunk

        type_name = _item_text(container, "Name", "")
        nickname = _item_text(container, "NickName", type_name)
        description = _item_text(container, "Description", "")
        guid = _item_text(container, "InstanceGuid", "")
        category = _item_text(container, "Category", "")
        subcategory = _item_text(container, "SubCategory", "")

        # Position
        x = y = 0.0
        bounds = _find_chunk(container, "Bounds")
        if bounds:
            loc = _find_item(bounds, "Location")
            if loc is not None:
                loc_text = loc.text or "0,0"
                parts = loc_text.split(",")
                try:
                    x, y = float(parts[0]), float(parts[1])
                except (ValueError, IndexError):
                    pass

        # Inputs / Outputs
        inputs_chunk = _find_chunk(container, "param_input")
        outputs_chunk = _find_chunk(container, "param_output")

        component = GHComponent(
            guid=guid,
            type_name=type_name,
            nickname=nickname,
            description=description,
            category=category,
            subcategory=subcategory,
            inputs=_parse_parameters(inputs_chunk),
            outputs=_parse_parameters(outputs_chunk),
            x=x,
            y=y,
        )

        # Detect groups
        if "Group" in type_name or nickname.startswith("Group"):
            defn.groups.append(GHGroup(nickname=nickname, description=description))
        else:
            defn.components.append(component)

        # Wires from input sources
        if inputs_chunk:
            for i, param in enumerate(inputs_chunk.findall("chunk")):
                sources = _find_chunk(param, "Sources")
                if sources is None:
                    continue
                for src_item in sources.findall("item"):
                    src_text = src_item.text or ""
                    # format: "guid:output_index"
                    match = re.match(r"([0-9a-fA-F\-]+):(\d+)", src_text)
                    if match:
                        defn.wires.append(GHWire(
                            from_component=match.group(1),
                            from_output=int(match.group(2)),
                            to_component=guid,
                            to_input=i,
                        ))

    return defn


def parse_ghx(content: bytes) -> GHDefinition:
    root = ET.fromstring(content)
    return _parse_ghx_tree(root)


def parse_gh(content: bytes) -> GHDefinition:
    """
    .gh files are a custom binary format. Many contain an embedded zip or
    XML section. Try common approaches before giving up.
    """
    # Attempt 1: treat as zip and look for XML inside
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.endswith(".ghx") or name.endswith(".xml"):
                    return parse_ghx(zf.read(name))
    except Exception:
        pass

    # Attempt 2: find embedded XML by looking for the GrasshopperData marker
    try:
        text = content.decode("utf-8", errors="replace")
        start = text.find("<?xml")
        if start == -1:
            start = text.find("<GrasshopperData")
        if start != -1:
            return parse_ghx(text[start:].encode("utf-8"))
    except Exception:
        pass

    # Attempt 3: scan for XML-like content after any binary header
    try:
        for encoding in ("utf-8", "utf-16", "latin-1"):
            text = content.decode(encoding, errors="ignore")
            match = re.search(r"<GrasshopperData", text)
            if match:
                return parse_ghx(text[match.start():].encode("utf-8"))
    except Exception:
        pass

    raise ValueError(
        "Cannot parse .gh file: binary format not recognized. "
        "Please save as .ghx (XML) from Grasshopper: File → Save As → Grasshopper XML (*.ghx)"
    )


def parse_file(filename: str, content: bytes) -> GHDefinition:
    if filename.lower().endswith(".ghx"):
        return parse_ghx(content)
    elif filename.lower().endswith(".gh"):
        return parse_gh(content)
    raise ValueError(f"Unsupported file type: {filename}. Use .gh or .ghx")
