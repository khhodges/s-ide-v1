import React from "react";

const GOLD = "#FFD700";
const DARK_BG = "#0d0900";
const CARD_BG = "#1a1100";
const BORDER = "#3a2a00";
const DIM = "#6a5800";

type Field = { label: string; bits: number; color: string; note?: string; changed?: boolean };

const C = {
  slot_id:      "#1565C0", gt_seq:   "#00897B", gt_type:   "#6A1B9A",
  dom:          "#E65100", perm:     "#AD1457", b_flag:    "#2E7D32",
  f_flag:       "#F9A825", g_bit:    "#4A148C", limit_off: "#0277BD",
  integrity:    "#37474F", abs_gt:   "#558B2F", lump_base: "#1A237E",
  magic:        "#B71C1C", n_minus6: "#880E4F", cw:        "#1B5E20",
  typ:          "#E65100", cc:       "#006064", heap:      "#4E342E",
  rsvd:         "#263238", opcode:   "#4527A0", cond:      "#00695C",
  fld_a:        "#C62828", fld_b:    "#AD1457", imm15:     "#0277BD",
  row:          "#1A237E",
};

function BitBar({ fields, total = 32 }: { fields: Field[]; total?: number }) {
  return (
    <div style={{ display:"flex", width:"100%", height:34, border:`1px solid ${BORDER}`, borderRadius:4, overflow:"hidden", marginBottom:4 }}>
      {fields.map((f, i) => (
        <div key={i} title={`${f.label}${f.note ? " — "+f.note : ""}`}
          style={{ width:`${(f.bits/total)*100}%`, background:f.color, display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:f.bits<=1?7:f.bits<=2?9:11, fontWeight:700, color:"#fff",
            textShadow:"0 1px 2px rgba(0,0,0,.8)", borderRight:i<fields.length-1?"1px solid rgba(0,0,0,.4)":"none",
            overflow:"hidden", whiteSpace:"nowrap",
            outline:f.changed?"2px solid "+GOLD:"none", outlineOffset:-2 }}>
          {f.bits>=3 ? f.label : ""}
        </div>
      ))}
    </div>
  );
}

function BitLabels({ fields, total=32 }: { fields: Field[]; total?: number }) {
  let pos = total-1;
  return (
    <div style={{ display:"flex", width:"100%", marginBottom:2 }}>
      {fields.map((f,i) => {
        const hi=pos, lo=pos-f.bits+1; pos=lo-1;
        return (
          <div key={i} style={{ width:`${(f.bits/total)*100}%`, fontSize:8, color:f.changed?GOLD:DIM,
            textAlign:"center", overflow:"hidden", whiteSpace:"nowrap", fontWeight:f.changed?700:400 }}>
            {f.bits===1?`[${hi}]`:`[${hi}:${lo}]`}
          </div>
        );
      })}
    </div>
  );
}

function Legend({ fields }: { fields: Field[] }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 14px", marginTop:6 }}>
      {fields.map((f,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10 }}>
          <div style={{ width:9, height:9, borderRadius:2, background:f.color,
            outline:f.changed?`2px solid ${GOLD}`:"none", outlineOffset:1 }}/>
          <span style={{ color:f.changed?GOLD:"#ccc" }}>
            <b style={{ color:f.changed?GOLD:"#fff" }}>{f.label}</b>
            {f.bits>1&&<span style={{ color:DIM }}> {f.bits}b</span>}
            {f.note&&<span style={{ color:"#888" }}> — {f.note}</span>}
            {f.changed&&<span style={{ color:GOLD }}> ★</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Tag({ t }: { t: "CM"|"IDE"|"BOTH" }) {
  const bg = t==="CM"?"#1a3a6a":t==="IDE"?"#3a1a00":"#2a2a00";
  const label = t==="BOTH"?"CM · IDE":t;
  return <span style={{ background:bg, color:GOLD, border:`1px solid ${BORDER}`, borderRadius:3,
    padding:"1px 6px", fontSize:10, fontWeight:700, marginLeft:8, verticalAlign:"middle" }}>{label}</span>;
}

function Section({ title, tag, sub, children }: { title:string; tag:"CM"|"IDE"|"BOTH"; sub?:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:28, background:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:8, padding:18 }}>
      <div style={{ marginBottom:12, borderBottom:`1px solid ${BORDER}`, paddingBottom:8 }}>
        <span style={{ fontSize:15, fontWeight:800, color:GOLD }}>{title}</span>
        <Tag t={tag}/>
        {sub&&<span style={{ fontSize:11, color:"#777", marginLeft:10 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, fields, note, changed, total=32 }: { label:string; fields:Field[]; note?:string; changed?:boolean; total?:number }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:11, color:changed?GOLD:"#aaa", marginBottom:2, fontWeight:changed?700:400 }}>
        {label}{note&&<span style={{ color:"#666", marginLeft:8 }}>{note}</span>}
        {changed&&<span style={{ color:GOLD, marginLeft:8 }}>★ updated</span>}
      </div>
      <BitLabels fields={fields} total={total}/>
      <BitBar fields={fields} total={total}/>
      <Legend fields={fields}/>
    </div>
  );
}

const GT: Field[] = [
  { label:"b_flag",  bits:1,  color:C.b_flag,  note:"SAVE allowed/prevented (per GT row)" },
  { label:"perm",    bits:3,  color:C.perm,     note:"dom=0: X,W,R  dom=1: E,S,L" },
  { label:"dom",     bits:1,  color:C.dom,      note:"0=Turing  1=Church" },
  { label:"gt_type", bits:2,  color:C.gt_type,  note:"01=Inform 10=Outform 11=Abstract", changed:true },
  { label:"gt_seq",  bits:9,  color:C.gt_seq,   note:"revocation counter 0–511", changed:true },
  { label:"slot_id", bits:16, color:C.slot_id,  note:"NS SLOT index 0–65535" },
];

const INSTR: Field[] = [
  { label:"opcode", bits:5,  color:C.opcode, note:"0–19 valid; 20–30 FAULT; 31(0x1F)=LUMP magic→FAULT" },
  { label:"cond",   bits:4,  color:C.cond,   note:"NV(15)=NOP  AL(14)=always" },
  { label:"fld_a",  bits:4,  color:C.fld_a,  note:"CR or DR index" },
  { label:"fld_b",  bits:4,  color:C.fld_b,  note:"CR or DR index" },
  { label:"imm15",  bits:15, color:C.imm15,  note:"15-bit immediate" },
];

const NS_W0: Field[] = [{ label:"lump_base — LUMP base byte address in DMEM", bits:32, color:C.lump_base }];

const NS_W1: Field[] = [
  { label:"f_flag",    bits:1,  color:C.f_flag,  note:"Far indicator (moved from GT[25])", changed:true },
  { label:"g_bit",     bits:1,  color:C.g_bit,   note:"GC mark bit (moved from [28])", changed:true },
  { label:"gt_seq",    bits:9,  color:C.gt_seq,  note:"must match GT.gt_seq", changed:true },
  { label:"limit_off", bits:21, color:C.limit_off, note:"lump size boundary" },
];

const NS_W2: Field[] = [{ label:"integrity32 — CRC-16/CCITT over W0+W1 (g_bit & f_flag cleared)", bits:32, color:C.integrity }];

const NS_W3: Field[] = [
  { label:"b",     bits:1,  color:C.b_flag },
  { label:"perm",  bits:3,  color:C.perm },
  { label:"dom",   bits:1,  color:C.dom },
  { label:"typ",   bits:2,  color:C.gt_type },
  { label:"seq",   bits:9,  color:C.gt_seq },
  { label:"slot_id",bits:16,color:C.slot_id },
];

const LH_CODE: Field[] = [
  { label:"magic 0x1F", bits:5,  color:C.magic,    note:"→FAULT if executed as INSTR" },
  { label:"n_minus6",   bits:4,  color:C.n_minus6, note:"size=2^(n+6) words" },
  { label:"cw",         bits:13, color:C.cw,        note:"code word count" },
  { label:"typ=00",     bits:2,  color:C.typ },
  { label:"cc",         bits:8,  color:C.cc,        note:"c-list row count" },
];

const LH_THREAD: Field[] = [
  { label:"magic 0x1F", bits:5,  color:C.magic },
  { label:"n_minus6",   bits:4,  color:C.n_minus6 },
  { label:"cw",         bits:13, color:C.cw,    note:"thread state words" },
  { label:"typ=10",     bits:2,  color:C.typ },
  { label:"heapWords",  bits:8,  color:C.heap,  note:"cc repurposed — IDE-set max heap" },
];

const LH_OUTFORM: Field[] = [
  { label:"magic 0x1F", bits:5,  color:C.magic },
  { label:"n_minus6",   bits:4,  color:C.n_minus6, note:"resolved lump size" },
  { label:"cw = N",     bits:13, color:C.cw,        note:"Pet-Name major component 0–8191" },
  { label:"typ=11",     bits:2,  color:C.typ },
  { label:"cc = M",     bits:8,  color:C.cc,        note:"Pet-Name minor component 0–255" },
];

const CR_W0 = GT;
const CR_W1: Field[] = [{ label:"lump_base — copied from NS SLOT Word 0 during LOAD", bits:32, color:C.row }];
const CR_W2 = NS_W1;

const CHANGES = [
  ["GT gt_seq", "7b at [22:16]", "9b at [24:16] ★", "2 freed bits; revocations 128→512"],
  ["GT gt_type", "2b at [24:23]", "2b at [26:25] ★", "shifted up because gt_seq grew"],
  ["GT f_flag", "1b at [25]", "REMOVED ★", "Far = SLOT property, not GT row property"],
  ["GT spare", "1b at [26]", "REMOVED ★", "absorbed by gt_seq expansion"],
  ["NS W1 gt_seq", "7b at [27:21]", "9b at [29:21] ★", "matches GT gt_seq width"],
  ["NS W1 g_bit", "1b at [28]", "1b at [30] ★", "moved for contiguous gt_seq"],
  ["NS W1 f_flag", "absent", "1b at [31] ★", "Far indicator moved from GT"],
  ["Outform cw/cc", "zero / undefined", "cw.cc = Pet-Name ★", "N.M namespace (2M names)"],
  ["NOP encoding", "all-zero word", "cond=NV(15), any opcode ★", "no HALT; NV=never-skip"],
];

export function HardwareFormats() {
  return (
    <div style={{ background:DARK_BG, color:"#e0c060", fontFamily:"'JetBrains Mono','Fira Code',monospace",
      padding:24, minHeight:"100vh", boxSizing:"border-box" }}>
      <div style={{ maxWidth:1360, margin:"0 auto" }}>

        <div style={{ marginBottom:24, borderBottom:`2px solid ${BORDER}`, paddingBottom:14 }}>
          <div style={{ fontSize:20, fontWeight:800, color:GOLD, letterSpacing:2, marginBottom:4 }}>
            CHURCH MACHINE v2.0 — HARDWARE FORMAT REFERENCE
          </div>
          <div style={{ fontSize:11, color:"#777", display:"flex", flexWrap:"wrap", gap:"0 24px" }}>
            <span>Source: <b style={{ color:GOLD }}>hardware/layouts.py</b></span>
            <span><b style={{ color:GOLD }}>★</b> = approved change from v1.x</span>
            <span>NULL GT = <b style={{ color:GOLD }}>0x00000000</b> (full-word zero check)</span>
            <span>NOP = any INSTR with <b style={{ color:GOLD }}>cond=NV(15)</b></span>
            <span>HALT does not exist</span>
          </div>
          <div style={{ marginTop:8, display:"flex", gap:16 }}>
            {[
              ["CM","#1a3a6a","Church Machine — hardware execution engine (Ti60 / simulator)"],
              ["IDE","#3a1a00","IDE — namespace manager, compiler, Pet-Name resolver"],
            ].map(([tag,bg,desc])=>(
              <div key={tag as string} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#aaa" }}>
                <span style={{ background:bg as string, color:GOLD, border:`1px solid ${BORDER}`, borderRadius:3,
                  padding:"1px 6px", fontSize:11, fontWeight:700 }}>{tag}</span>
                {desc}
              </div>
            ))}
          </div>
        </div>

        {/* PUBLIC TYPE 1: GT */}
        <Section title="PUBLIC TYPE 1 — GOLDEN TOKEN (GT)" tag="BOTH"
          sub="32-bit · programmer-visible · stored in c-list ROWS · [CM] validates on every instruction · [IDE] assigns at boot">
          <Row label="GT word — new v2.0 layout" fields={GT} changed/>
          <div style={{ fontSize:11, color:"#888", lineHeight:1.9, marginTop:4 }}>
            <div><b style={{color:GOLD}}>★ gt_seq [24:16]</b>  9 bits  — was 7 bits at [22:16].  Revocations 128→512.  <b style={{color:"#aaa"}}>[CM]</b> increments in NS SLOT; <b style={{color:"#aaa"}}>[CM]</b> checks on every LOAD.</div>
            <div><b style={{color:GOLD}}>★ gt_type [26:25]</b>  shifted from [24:23] — gt_seq now occupies [24:16].  01=Inform  10=Outform  11=Abstract.  00=NULL (full word must be 0x00000000).</div>
            <div><b style={{color:"#ccc"}}>f_flag REMOVED</b> — Far indicator is a property of the NS SLOT (hidden), not the GT row.  Moved to SLOT Word 1 [31].</div>
            <div><b style={{color:"#ccc"}}>b_flag [31]</b> — SAVE permission is per-GT row.  Two rows pointing to the same SLOT can have different SAVE rights.</div>
            <div><b style={{color:"#ccc"}}>Outform × Far  (4 valid combinations):</b>
              <span style={{color:"#888"}}> Outform = Pet-Name typed by <b style={{color:"#aaa"}}>[IDE]</b>;  Far = remote <b style={{color:"#aaa"}}>[IDE]</b> node resolves.  Orthogonal.</span></div>
          </div>
        </Section>

        {/* PUBLIC TYPE 2: INSTR */}
        <Section title="PUBLIC TYPE 2 — INSTRUCTION (INSTR)" tag="CM"
          sub="32-bit · programmer-visible · [IDE] compiles · [CM] fetches and executes">
          <Row label="INSTR word" fields={INSTR}/>
          <div style={{ fontSize:11, color:"#888", lineHeight:1.9, marginTop:4 }}>
            <div><b style={{color:"#ccc"}}>opcode [31:27]</b>  0–19 valid;  20–30 undefined → <b style={{color:"#f44"}}>FAULT</b>;  31 (0x1F) = LUMP magic → <b style={{color:"#f44"}}>FAULT</b> (traps if header is fetched as instruction)</div>
            <div><b style={{color:"#ccc"}}>NOP</b> = any INSTR with cond=NV(15).  The instruction is always skipped; opcode/operands irrelevant.</div>
            <div><b style={{color:"#ccc"}}>HALT does not exist.</b>  Programs end by faulting, not returning, or looping.</div>
            <div style={{marginTop:6}}>
              <span style={{color:"#aaa", fontWeight:700}}>Church domain (capability):</span>
              <span style={{color:"#888"}}> LOAD SAVE CALL RETURN CHANGE SWITCH TPERM LAMBDA ELOADCALL XLOADLAMBDA</span>
            </div>
            <div>
              <span style={{color:"#aaa", fontWeight:700}}>Turing domain (data):       </span>
              <span style={{color:"#888"}}> DREAD DWRITE BFEXT BFINS MCMP IADD ISUB BRANCH SHL SHR</span>
            </div>
          </div>
        </Section>

        {/* HIDDEN A: NS SLOT */}
        <Section title="HIDDEN DETAIL A — NS SLOT" tag="BOTH"
          sub="4 × 32-bit = 128-bit · [IDE] creates · [CM] reads via mLoad · not programmer-visible · stride = slot_id × 16 bytes">
          <Row label="Word 0  lump_base" fields={NS_W0}/>
          <Row label="Word 1  authority (WORD2_LAYOUT ★)" fields={NS_W1} changed/>
          <Row label="Word 2  integrity32" fields={NS_W2}/>
          <Row label="Word 3  abstract_gt (advisory — not in CRC)" fields={NS_W3}/>
          <div style={{ fontSize:11, color:"#888", lineHeight:1.9, marginTop:4 }}>
            <div><b style={{color:GOLD}}>★ f_flag [31]</b>  moved from GT[25].  0=local <b style={{color:"#aaa"}}>[IDE]</b> node  1=Far remote <b style={{color:"#aaa"}}>[IDE]</b> node.  Set by <b style={{color:"#aaa"}}>[IDE]</b>.</div>
            <div><b style={{color:GOLD}}>★ g_bit [30]</b>  moved from [28] to make gt_seq contiguous.  Set by <b style={{color:"#aaa"}}>[CM]</b> GC without invalidating CRC (masked before compute).</div>
            <div><b style={{color:GOLD}}>★ gt_seq [29:21]</b>  9 bits — matches GT gt_seq width.  <b style={{color:"#aaa"}}>[IDE]</b> increments to revoke; <b style={{color:"#aaa"}}>[CM]</b> compares on every LOAD.</div>
            <div><b style={{color:"#ccc"}}>Word 3  abstract_gt</b>  advisory label for <b style={{color:"#aaa"}}>[IDE]</b> namespace viewer.  <b style={{color:"#aaa"}}>[CM]</b> reads only on M-elevation path.  Never loaded into a CAP_REG.</div>
          </div>
        </Section>

        {/* HIDDEN B: LUMP HEADER */}
        <Section title="HIDDEN DETAIL B — LUMP_HEADER" tag="BOTH"
          sub="32-bit · word 0 at lump_base · [IDE] creates · [CM] reads at LOAD (cLoad) · not programmer-visible">
          <Row label="typ=00  Code LUMP" fields={LH_CODE}
            note="cw=code words  cc=c-list rows"/>
          <Row label="typ=10  Thread LUMP" fields={LH_THREAD}
            note="cc repurposed as heapWords — IDE-set max heap"/>
          <Row label="typ=11  Outform LUMP  ── Pet-Name = cw.cc" fields={LH_OUTFORM}
            note='e.g. cw=4,cc=7 → Pet-Name "4.7"  (2,097,152 unique names)'/>
          <div style={{ fontSize:11, color:"#888", lineHeight:1.9, marginTop:4 }}>
            <div><b style={{color:"#ccc"}}>magic 0x1F</b>  top 5 bits of every LUMP header.  opcode=31 = undefined → <b style={{color:"#f44"}}>FAULT</b> if fetched as INSTR.  Not a software sentinel — it is a physically impossible opcode.</div>
            <div><b style={{color:"#ccc"}}>n_minus_6</b>  applies to the resolved LUMP.  For Outform: <b style={{color:"#aaa"}}>[IDE]</b> allocates this size when fetching via Tunnel.</div>
            <div><b style={{color:"#ccc"}}>Outform cw.cc</b>  <b style={{color:"#aaa"}}>[IDE]</b> defines the Pet-Name namespace and resolves <b style={{color:GOLD}}>N.M</b> → real LUMP.  <b style={{color:"#aaa"}}>[CM]</b> sees only an Outform GT and triggers the Outform protocol.</div>
          </div>
        </Section>

        {/* HIDDEN C: CAP_REG */}
        <Section title="HIDDEN DETAIL C — CAP_REG  (CR0–CR15)" tag="CM"
          sub="3 × 32-bit = 96-bit · [CM] writes at LOAD · [CM] reads on every instruction · not programmer-visible">
          <Row label="Word 0  GT row (GT_LAYOUT)" fields={CR_W0} changed/>
          <Row label="Word 1  lump_base (from NS SLOT Word 0)" fields={CR_W1}/>
          <Row label="Word 2  authority (WORD2_LAYOUT, from NS SLOT Word 1)" fields={CR_W2} changed/>
          <div style={{ fontSize:11, color:"#888", lineHeight:1.9, marginTop:4 }}>
            <div><b style={{color:"#ccc"}}>LOAD path:</b>  c-list ROW (GT) → <b style={{color:"#aaa"}}>[CM]</b> mLoad → NS[GT.slot_id] SLOT → CR.W0=GT · CR.W1=lump_base · CR.W2=authority</div>
            <div>Revocation check: GT.gt_seq ≠ SLOT.W1.gt_seq → <b style={{color:"#f44"}}>FAULT</b>.  CRC check: SLOT.W2 mismatch → <b style={{color:"#f44"}}>FAULT</b>.</div>
            <div>CR Word 3 does not exist.  NS SLOT Word 3 (abstract_gt) is advisory only — never loaded into a CAP_REG.</div>
          </div>
        </Section>

        {/* Change table */}
        <div style={{ background:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:8, padding:18, marginBottom:28 }}>
          <div style={{ fontSize:15, fontWeight:800, color:GOLD, marginBottom:12, borderBottom:`1px solid ${BORDER}`, paddingBottom:8 }}>
            v2.0 CHANGE SUMMARY
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr>{["Field","Before","After","Rationale"].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"3px 10px",color:GOLD,fontWeight:700,borderBottom:`1px solid ${BORDER}`}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {CHANGES.map((r,i)=>(
                <tr key={i} style={{background:i%2===0?"rgba(255,215,0,0.02)":"transparent"}}>
                  {r.map((c,j)=>(
                    <td key={j} style={{padding:"4px 10px",color:c.includes("★")?GOLD:j===0?"#fff":"#999",
                      fontWeight:c.includes("★")?700:400,borderBottom:`1px solid rgba(58,42,0,0.4)`}}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Machine matrix */}
        <div style={{ background:CARD_BG, border:`1px solid ${BORDER}`, borderRadius:8, padding:18 }}>
          <div style={{ fontSize:15, fontWeight:800, color:GOLD, marginBottom:12, borderBottom:`1px solid ${BORDER}`, paddingBottom:8 }}>
            MACHINE OWNERSHIP
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr>{["Format","Created by","Read by","Programmer-visible"].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"3px 10px",color:GOLD,fontWeight:700,borderBottom:`1px solid ${BORDER}`}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {[
                ["GT (Public Type 1)","[CM] Mint / [IDE] boot image","[CM] mLoad on every instruction","✅ c-list ROW"],
                ["INSTR (Public Type 2)","[IDE] CLOOMC compiler","[CM] fetch-decode-execute","✅ code in LUMP"],
                ["NS SLOT","[IDE] boot image + Loader","[CM] mLoad pipeline","❌ hidden detail"],
                ["LUMP_HEADER","[IDE] compiler / assembler","[CM] at LOAD via cLoad","❌ hidden detail"],
                ["CAP_REG (CR0–CR15)","[CM] LOAD instruction","[CM] decode + perm check","❌ hidden detail"],
              ].map((r,i)=>(
                <tr key={i} style={{background:i%2===0?"rgba(255,215,0,0.02)":"transparent"}}>
                  {r.map((c,j)=>(
                    <td key={j} style={{padding:"4px 10px",
                      color:c.includes("[CM]")&&c.includes("[IDE]")?"#FFD700":c.includes("[CM]")?"#64B5F6":c.includes("[IDE]")?"#FFB74D":c.includes("✅")?"#66BB6A":c.includes("❌")?"#EF5350":j===0?"#fff":"#aaa",
                      borderBottom:`1px solid rgba(58,42,0,0.4)`,fontWeight:j===0?700:400}}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
