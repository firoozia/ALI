"""
Claude-based Grasshopper definition analyzer.
Converts parsed GH structure into a rich Cursor-ready prompt.
"""
import os
import anthropic
from parser.gh_parser import GHDefinition, GHComponent


def _build_structure_text(defn: GHDefinition) -> str:
    lines = []

    lines.append(f"Total components: {len(defn.components)}")
    lines.append(f"Total wire connections: {len(defn.wires)}")
    if defn.groups:
        lines.append(f"Groups: {', '.join(g.nickname for g in defn.groups)}")

    # Build a guid->component map for wire resolution
    guid_map: dict[str, GHComponent] = {c.guid: c for c in defn.components}

    lines.append("\n=== COMPONENTS ===")
    for comp in defn.components:
        lines.append(f"\n[{comp.type_name}] \"{comp.nickname}\"")
        if comp.description:
            lines.append(f"  Description: {comp.description}")
        if comp.category:
            lines.append(f"  Category: {comp.category} > {comp.subcategory}")
        if comp.inputs:
            ins = ", ".join(f"{p.nickname}({p.access})" for p in comp.inputs)
            lines.append(f"  Inputs:  {ins}")
        if comp.outputs:
            outs = ", ".join(p.nickname for p in comp.outputs)
            lines.append(f"  Outputs: {outs}")

    if defn.wires:
        lines.append("\n=== DATA FLOW (WIRES) ===")
        for wire in defn.wires:
            src = guid_map.get(wire.from_component)
            dst = guid_map.get(wire.to_component)
            src_name = f"{src.nickname}[out{wire.from_output}]" if src else wire.from_component
            dst_name = f"{dst.nickname}[in{wire.to_input}]" if dst else wire.to_component
            lines.append(f"  {src_name}  →  {dst_name}")

    return "\n".join(lines)


SYSTEM_PROMPT = """\
You are an expert Grasshopper 3D / computational design analyst and software architect.
Your job is to analyze a Grasshopper visual program structure and produce a clear,
actionable "Cursor prompt" that a developer can paste into Cursor to:
1. Understand the algorithm's logic, data flow, and design intent.
2. Recreate or port the logic to Python/C# code.
3. Extend or debug the definition.

Your output MUST follow this exact structure:

## 🦗 Grasshopper Definition Analysis

### Summary
(2-4 sentence overview of what this definition does)

### Algorithm & Logic
(Step-by-step breakdown of the computational logic — what each major stage does)

### Data Flow
(Describe how data moves through the definition — inputs, transformations, outputs)

### Key Components
(List and explain the most important components and why they matter)

### Design Patterns Used
(Identify patterns: parametric recursion, data trees, attractor fields, mesh operations, etc.)

### Cursor Prompt
(A ready-to-paste prompt the user can give Cursor to implement this logic in code.
 Write it as a self-contained instruction block starting with "You are a...")

### Suggested Code Structure
(High-level class/function breakdown for a Python implementation)
"""


def analyze(defn: GHDefinition, api_key: str | None = None) -> str:
    key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY is not set")

    client = anthropic.Anthropic(api_key=key)
    structure_text = _build_structure_text(defn)

    user_message = f"""\
Below is the parsed structure of a Grasshopper definition. Analyze it and produce
the full structured output described in the system prompt.

--- GRASSHOPPER STRUCTURE ---
{structure_text}
--- END STRUCTURE ---
"""

    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    return message.content[0].text
