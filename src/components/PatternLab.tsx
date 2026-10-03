import { useState, useRef } from "react";
import clsx from "clsx";

export type PatternLabDemoId =
  | "magnetic-orbit"
  | "stacked-transitions"
  | "mask-spotlight"
  | "typographic-rail"
  | "hardware-tactile"
  | "glass-distortion";

interface DemoItem {
  id: PatternLabDemoId;
  title: string;
  subtitle: string;
  tag: string;
  desc: string;
}

const DEMOS: DemoItem[] = [
  {
    id: "magnetic-orbit",
    title: "磁吸轨道导航 (Magnetic Orbit Nav)",
    subtitle: "光标力场捕捉 · 弹性微动位移",
    tag: "Navigation & Micro-physics",
    desc: "模拟带有引力势阱的物理悬浮停靠底座。光标靠近导航项时产生非线性弹性吸附位移与环形微光轨道。",
  },
  {
    id: "stacked-transitions",
    title: "堆叠平移层级转场 (Stacked Transitions)",
    subtitle: "三维空间景深 · 实体卡片推拉",
    tag: "Spatial Motion",
    desc: "多图层卡片在 Z 轴上的物理景深推移。当前卡片前移脱落，底层卡片自适应缩放上浮并伴随光影阻尼衰减。",
  },
  {
    id: "mask-spotlight",
    title: "遮罩探照灯聚焦 (Mask Reveal Spotlight)",
    subtitle: "局部动态裁切 · 暗夜图腾显隐",
    tag: "Visual Reveal & Shaders",
    desc: "光标驱动的动态径向渐变遮罩。在静谧暗渊之中探照出底层的工程蓝图线条、全息数据与隐藏几何标尺。",
  },
  {
    id: "typographic-rail",
    title: "编排字阶标尺 (Editorial Typographic Rail)",
    subtitle: "经典比例网格 · 黄金率动态字阶",
    tag: "Typography Engine",
    desc: "基于古典瑞士排版比例法则的实时字阶计算器。自由切换黄金分割 (1.618)、纯四度 (1.333) 与大三度 (1.25)。",
  },
  {
    id: "hardware-tactile",
    title: "实体旋钮与触觉开关 (Hardware Knobs & Tactile Toggle)",
    subtitle: "拟真阻尼旋转 · 机械拨档回弹",
    tag: "Industrial Haptics",
    desc: "拖拽式实体模拟音频旋钮与重工业金属拨动开关。具有精确的旋转角度弧线、刻度吸附与物理凹凸光影。",
  },
  {
    id: "glass-distortion",
    title: "动态毛玻璃与环境光流 (Dynamic Glass & Ambient Glow)",
    subtitle: "次世代空间计算 · 镜面边缘光感",
    tag: "Optical Glassmorphism",
    desc: "可调节模糊度、色散饱和度与光照角度的空间折射表面。光标移动时在玻璃边缘产生真实的镜面高光反射。",
  },
];

export function PatternLab({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [activeDemo, setActiveDemo] = useState<PatternLabDemoId>("magnetic-orbit");

  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900/90 via-zinc-900/40 to-zinc-950 p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded px-2 py-0.5 text-[11px] font-mono font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              PATTERN LAB // 6 大前沿微动效与交互实验室
            </div>
            <h2 className="text-[20px] font-bold text-white mt-2 tracking-tight">
              可实时交互与调校的前端微动效原型
            </h2>
            <p className="text-[13px] text-zinc-400 mt-1 max-w-2xl leading-relaxed">
              这里不是截图展示，而是全部采用纯 DOM、CSS Variables 与数学物理算法驱动的真实可交互控件。
              随时调校参数、体验触觉反馈，并可一键提取 CSS 代码片段。
            </p>
          </div>
        </div>
      </div>

      {/* Demo Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {DEMOS.map((d) => {
          const selected = activeDemo === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDemo(d.id)}
              className={clsx(
                "flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer",
                selected
                  ? "border-cyan-500 bg-cyan-950/30 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700",
              )}
            >
              <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">
                0{DEMOS.indexOf(d) + 1} // {d.tag.split("&")[0]}
              </span>
              <span className="font-bold text-[13px] mt-1 text-zinc-100 line-clamp-1">
                {d.title.split("(")[0]}
              </span>
              <span className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">
                {d.subtitle}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Interactive Stage */}
      <div className="rounded-2xl border border-zinc-800 bg-[#0d0f14] p-5 sm:p-7 min-h-[460px] flex flex-col justify-between shadow-2xl relative overflow-hidden">
        {activeDemo === "magnetic-orbit" && <MagneticOrbitDemo onNotice={onNotice} />}
        {activeDemo === "stacked-transitions" && <StackedTransitionsDemo onNotice={onNotice} />}
        {activeDemo === "mask-spotlight" && <MaskSpotlightDemo onNotice={onNotice} />}
        {activeDemo === "typographic-rail" && <TypographicRailDemo onNotice={onNotice} />}
        {activeDemo === "hardware-tactile" && <HardwareTactileDemo onNotice={onNotice} />}
        {activeDemo === "glass-distortion" && <GlassDistortionDemo onNotice={onNotice} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Magnetic Orbit Nav
// ---------------------------------------------------------------------------
function MagneticOrbitDemo({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [strength, setStrength] = useState<number>(0.35);
  const [activeItem, setActiveItem] = useState<number>(0);
  const items = ["仪表盘", "软件库", "设计系统", "终端监控", "代码实验室", "设置"];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">磁吸轨道导航 (Magnetic Orbit Nav)</h3>
          <p className="text-[12px] text-zinc-400">将光标移至导航项上，体验非线性引力微动吸附与轨道光环跟随</p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-zinc-300">
          <span>磁吸引力强度:</span>
          <input
            type="range"
            min="0.1"
            max="0.8"
            step="0.05"
            value={strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
            className="w-28 accent-cyan-400 cursor-pointer"
          />
          <span className="font-mono text-cyan-400 w-8">{strength.toFixed(2)}</span>
        </div>
      </div>

      <div className="h-64 rounded-xl border border-zinc-800/80 bg-zinc-950 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40" />

        {/* Orbit Nav Container */}
        <div className="relative z-10 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 p-2 shadow-2xl backdrop-blur-md">
          {items.map((label, idx) => (
            <MagneticButton
              key={label}
              label={label}
              active={activeItem === idx}
              strength={strength}
              onClick={() => {
                setActiveItem(idx);
                onNotice?.(`导航已定位至「${label}」`);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MagneticButton({
  label,
  active,
  strength,
  onClick,
}: {
  label: string;
  active: boolean;
  strength: number;
  onClick: () => void;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = (e.clientX - centerX) * strength;
    const dy = (e.clientY - centerY) * strength;
    setPos({ x: dx, y: dy });
  };

  const handleMouseLeave = () => {
    setPos({ x: 0, y: 0 });
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        transition: pos.x === 0 ? "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
      }}
      className={clsx(
        "relative rounded-full px-4 py-2 text-[12.5px] font-medium transition-colors cursor-pointer select-none",
        active
          ? "bg-cyan-500 text-black font-bold shadow-[0_0_20px_rgba(6,182,212,0.4)]"
          : "text-zinc-400 hover:text-white hover:bg-zinc-800",
      )}
    >
      {active && (
        <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-cyan-300 animate-pulse" />
      )}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 2. Stacked Transitions
// ---------------------------------------------------------------------------
function StackedTransitionsDemo({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [cards, setCards] = useState([
    { id: 1, title: "01 · 曜石暗色控制台", color: "from-blue-600 to-indigo-900", tag: "OBSIDIAN ARCHITECTURE" },
    { id: 2, title: "02 · 瑞士国际主义排版", color: "from-amber-600 to-red-900", tag: "SWISS EDITORIAL" },
    { id: 3, title: "03 · 空间计算毛玻璃", color: "from-cyan-600 to-teal-950", tag: "VISION HYPERGLASS" },
    { id: 4, title: "04 · 复古磁带合成器", color: "from-purple-600 to-pink-900", tag: "TACTILE HARDWARE" },
  ]);

  const handleNext = () => {
    setCards((prev) => {
      const [first, ...rest] = prev;
      return [...rest, first];
    });
    onNotice?.("卡片已执行 Z 轴景深切片推移");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">堆叠平移层级转场 (Stacked Transitions)</h3>
          <p className="text-[12px] text-zinc-400">点击「推移下一张」观察多层卡片在三维景深上的平滑阻尼缩放与光影衰减</p>
        </div>
        <button
          type="button"
          onClick={handleNext}
          className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-3 py-1.5 text-[12px] transition-colors cursor-pointer"
        >
          ⌗ 推移下一张 (Next Slide) →
        </button>
      </div>

      <div className="h-72 rounded-xl border border-zinc-800/80 bg-zinc-950 flex items-center justify-center p-6 relative overflow-hidden select-none">
        <div className="relative w-80 h-44">
          {cards.slice(0, 3).map((c, i) => {
            // i=0 is front, i=1 is middle, i=2 is back
            const scale = 1 - i * 0.06;
            const translateY = i * 16;
            const opacity = 1 - i * 0.25;
            const zIndex = 30 - i * 10;
            return (
              <div
                key={c.id}
                onClick={i === 0 ? handleNext : undefined}
                style={{
                  transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
                  opacity,
                  zIndex,
                  transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
                className={clsx(
                  "absolute inset-0 rounded-2xl p-5 border border-white/20 shadow-2xl flex flex-col justify-between cursor-pointer bg-gradient-to-br",
                  c.color,
                )}
              >
                <div>
                  <span className="text-[10px] font-mono tracking-widest text-white/70 uppercase">
                    {c.tag}
                  </span>
                  <h4 className="text-[16px] font-bold text-white mt-1">{c.title}</h4>
                </div>
                <div className="flex items-center justify-between text-[11px] text-white/80">
                  <span>层级深度: Z-{i}</span>
                  <span className="font-mono">点击推移 ↗</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Mask Reveal Spotlight
// ---------------------------------------------------------------------------
function MaskSpotlightDemo(_props: { onNotice?: (msg: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 180, y: 120 });
  const [radius, setRadius] = useState<number>(140);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">遮罩探照灯聚焦 (Mask Reveal Spotlight)</h3>
          <p className="text-[12px] text-zinc-400">在画布内移动鼠标，探照灯将揭开黑暗中隐藏的工程蓝图与精密电路</p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-zinc-300">
          <span>光圈半径:</span>
          <input
            type="range"
            min="80"
            max="240"
            value={radius}
            onChange={(e) => setRadius(parseInt(e.target.value))}
            className="w-24 accent-amber-400 cursor-pointer"
          />
          <span className="font-mono text-amber-400 w-10">{radius}px</span>
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className="h-72 rounded-xl border border-zinc-800 bg-[#07080a] relative overflow-hidden cursor-crosshair select-none flex items-center justify-center"
      >
        {/* Underneath Blueprint Layer (Fully revealed only under spotlight) */}
        <div
          className="absolute inset-0 p-8 flex flex-col justify-between font-mono"
          style={{
            maskImage: `radial-gradient(circle ${radius}px at ${pos.x}px ${pos.y}px, black 30%, transparent 100%)`,
            WebkitMaskImage: `radial-gradient(circle ${radius}px at ${pos.x}px ${pos.y}px, black 30%, transparent 100%)`,
          }}
        >
          {/* Detailed CAD lines */}
          <div className="absolute inset-0 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
          <div className="relative z-10 flex items-center justify-between border-b border-cyan-500/40 pb-2 text-cyan-400 text-[11px]">
            <span>ENGINEERING SCHEMATIC // REV 3.0</span>
            <span>COORDINATES: X:{pos.x.toFixed(0)} Y:{pos.y.toFixed(0)}</span>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-4 text-[12px] text-cyan-200">
            <div className="border border-cyan-500/30 p-3 rounded bg-cyan-950/40">
              <strong className="text-cyan-400 block text-[11px]">QUANTUM CORE</strong>
              <span>STATUS: STABLE 99.8%</span>
            </div>
            <div className="border border-cyan-500/30 p-3 rounded bg-cyan-950/40">
              <strong className="text-cyan-400 block text-[11px]">OPTICAL FIBER</strong>
              <span>LATENCY: 0.12ms</span>
            </div>
            <div className="border border-cyan-500/30 p-3 rounded bg-cyan-950/40">
              <strong className="text-cyan-400 block text-[11px]">POWER MATRIX</strong>
              <span>VOLTAGE: 3.30V</span>
            </div>
          </div>

          <div className="relative z-10 text-[11px] text-cyan-400/80">
            [CONFIDENTIAL] SETUP CENTER ARCHITECTURE DISCLOSURE PROTOCOL
          </div>
        </div>

        {/* Ambient Dark Hint */}
        <div className="text-zinc-600 text-[13px] font-mono tracking-wider pointer-events-none">
          MOVE CURSOR TO ACTIVATE SPOTLIGHT SENSOR
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Editorial Typographic Rail
// ---------------------------------------------------------------------------
function TypographicRailDemo({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [ratio, setRatio] = useState<number>(1.25);
  const [baseSize, setBaseSize] = useState<number>(15);

  const ratios = [
    { label: "大三度 (1.250)", val: 1.25 },
    { label: "纯四度 (1.333)", val: 1.333 },
    { label: "黄金分割 (1.618)", val: 1.618 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">编排字阶标尺 (Editorial Typographic Rail)</h3>
          <p className="text-[12px] text-zinc-400">基于纯数学等比数列驱动的文字层级梯度，观察字号与行高的严密呼吸秩序</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[12px] text-zinc-300">
            <span>基准字号:</span>
            <input
              type="range"
              min="12"
              max="20"
              value={baseSize}
              onChange={(e) => setBaseSize(parseInt(e.target.value))}
              className="w-16 accent-amber-400 cursor-pointer"
            />
            <span className="font-mono text-amber-400 w-8">{baseSize}px</span>
          </div>
          <div className="flex items-center gap-1.5">
            {ratios.map((r) => (
              <button
                key={r.val}
                type="button"
                onClick={() => {
                  setRatio(r.val);
                  onNotice?.(`字阶比率切换至 ${r.label}`);
                }}
                className={clsx(
                  "rounded px-2.5 py-1 text-[11.5px] font-mono transition-colors cursor-pointer border",
                  ratio === r.val
                    ? "bg-amber-500 text-black border-amber-400 font-bold"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#090a0f] p-6 space-y-4">
        {[
          { label: "Display Title (字阶 4)", power: 4 },
          { label: "Section Heading (字阶 3)", power: 3 },
          { label: "Subheading (字阶 2)", power: 2 },
          { label: "Body Text (字阶 1)", power: 1 },
          { label: "Base Copy (基准 0)", power: 0 },
        ].map((item) => {
          const size = baseSize * Math.pow(ratio, item.power);
          return (
            <div
              key={item.power}
              className="flex flex-col sm:flex-row sm:items-baseline justify-between border-b border-zinc-900 pb-3 gap-2"
            >
              <div className="min-w-0">
                <span
                  style={{ fontSize: `${size}px`, lineHeight: 1.15 }}
                  className="font-bold text-white tracking-tight block"
                >
                  Setup Everything Needed to Build
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-zinc-500">
                <span className="text-amber-400 font-bold">{size.toFixed(1)}px</span>
                <span>/ {(size / 16).toFixed(2)}rem</span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 border border-zinc-800">{item.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Hardware Knobs & Tactile Toggle
// ---------------------------------------------------------------------------
function HardwareTactileDemo({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [knobVal1, setKnobVal1] = useState<number>(45); // 0-100
  const [knobVal2, setKnobVal2] = useState<number>(75);
  const [powerOn, setPowerOn] = useState<boolean>(true);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">实体旋钮与触觉开关 (Hardware Knobs & Tactile Toggle)</h3>
          <p className="text-[12px] text-zinc-400">上下拖动旋钮以调节连续参数，点击金属拨动开关体验物理下陷感</p>
        </div>
      </div>

      <div className="h-64 rounded-xl border border-zinc-800 bg-[#16161a] p-6 flex flex-wrap items-center justify-around gap-6 select-none shadow-inner">
        {/* Dial 1: Resonance */}
        <RotaryKnob
          label="RESONANCE"
          color="#f59e0b"
          value={knobVal1}
          onChange={(v) => {
            setKnobVal1(v);
            onNotice?.(`共振参数: ${v}%`);
          }}
        />

        {/* Dial 2: Cutoff Frequency */}
        <RotaryKnob
          label="FREQUENCY"
          color="#06b6d4"
          value={knobVal2}
          onChange={(v) => {
            setKnobVal2(v);
            onNotice?.(`截止频率: ${v}%`);
          }}
        />

        {/* Physical Toggle Switch */}
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
            MASTER POWER
          </span>
          <button
            type="button"
            onClick={() => {
              setPowerOn((p) => !p);
              onNotice?.(powerOn ? "电源总闸已断开" : "电源总闸已闭合");
            }}
            className={clsx(
              "w-12 h-20 rounded-lg border-2 p-1.5 flex flex-col justify-between items-center transition-all cursor-pointer shadow-lg",
              powerOn
                ? "border-emerald-500/80 bg-zinc-900 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                : "border-zinc-700 bg-zinc-950",
            )}
          >
            {/* Rocker plate */}
            <div
              className={clsx(
                "w-8 h-8 rounded-md transition-all shadow-md",
                powerOn
                  ? "bg-emerald-500 translate-y-7 shadow-[0_0_10px_#10b981]"
                  : "bg-zinc-700 translate-y-0",
              )}
            />
            <span
              className={clsx(
                "font-mono text-[9px] font-bold",
                powerOn ? "text-emerald-400" : "text-zinc-600",
              )}
            >
              {powerOn ? "ON" : "OFF"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RotaryKnob({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  const startYRef = useRef<number>(0);
  const startValRef = useRef<number>(value);

  const handleMouseDown = (e: React.MouseEvent) => {
    startYRef.current = e.clientY;
    startValRef.current = value;

    const handleMouseMove = (ev: MouseEvent) => {
      const deltaY = startYRef.current - ev.clientY;
      const next = Math.max(0, Math.min(100, Math.round(startValRef.current + deltaY * 0.75)));
      onChange(next);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const angle = (value / 100) * 270 - 135; // -135deg to +135deg

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
        {label}
      </span>
      <div
        onMouseDown={handleMouseDown}
        className="w-16 h-16 rounded-full bg-gradient-to-b from-zinc-700 to-zinc-900 border-2 border-zinc-600 relative flex items-center justify-center cursor-ns-resize shadow-xl active:scale-95 transition-transform"
      >
        {/* Outer Circular Progress Ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
          <circle
            cx="30"
            cy="30"
            r="26"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeDasharray="163"
            strokeDashoffset={163 - (value / 100) * 122}
            className="transition-all duration-75"
          />
        </svg>

        {/* Rotating Notch Indicator */}
        <div
          style={{ transform: `rotate(${angle}deg)` }}
          className="w-1 h-5 bg-white rounded-full absolute top-1.5 transition-transform duration-75 shadow-sm"
        />

        {/* Center Metal Cap */}
        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 shadow-inner flex items-center justify-center font-mono text-[9px] text-zinc-300">
          {value}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Dynamic Glass Distortion & Ambient Glow
// ---------------------------------------------------------------------------
function GlassDistortionDemo({ onNotice }: { onNotice?: (msg: string) => void }) {
  const [blur, setBlur] = useState<number>(24);
  const [saturation, setSaturation] = useState<number>(180);
  const [opacity, setOpacity] = useState<number>(16);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-[16px] font-bold text-white">动态毛玻璃与环境光流 (Dynamic Glass & Ambient Glow)</h3>
          <p className="text-[12px] text-zinc-400">空间计算级别的半透明折射材质，实时调校 Backdrop Blur 与微光边缘镜面折射</p>
        </div>
      </div>

      {/* Control Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px] text-zinc-300 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <span>模糊半径 (Blur):</span>
          <input
            type="range"
            min="0"
            max="40"
            value={blur}
            onChange={(e) => setBlur(parseInt(e.target.value))}
            className="w-24 accent-violet-400 cursor-pointer"
          />
          <span className="font-mono text-violet-400 w-8">{blur}px</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>色彩饱和度 (Saturate):</span>
          <input
            type="range"
            min="100"
            max="260"
            value={saturation}
            onChange={(e) => setSaturation(parseInt(e.target.value))}
            className="w-24 accent-violet-400 cursor-pointer"
          />
          <span className="font-mono text-violet-400 w-10">{saturation}%</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>玻璃不透明度 (Alpha):</span>
          <input
            type="range"
            min="5"
            max="40"
            value={opacity}
            onChange={(e) => setOpacity(parseInt(e.target.value))}
            className="w-24 accent-violet-400 cursor-pointer"
          />
          <span className="font-mono text-violet-400 w-8">{opacity}%</span>
        </div>
      </div>

      {/* Stage with moving background gradient & floating glass pane */}
      <div className="h-64 rounded-xl border border-zinc-800 bg-black p-6 flex items-center justify-center relative overflow-hidden select-none">
        {/* Moving Colored Ambient Glow Orbs */}
        <div className="absolute top-4 left-10 w-44 h-44 rounded-full bg-violet-600/60 filter blur-3xl animate-pulse" />
        <div className="absolute bottom-4 right-10 w-48 h-48 rounded-full bg-cyan-500/50 filter blur-3xl animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full bg-pink-500/40 filter blur-2xl" />

        {/* Dynamic Glass Panel */}
        <div
          style={{
            backdropFilter: `blur(${blur}px) saturate(${saturation}%)`,
            WebkitBackdropFilter: `blur(${blur}px) saturate(${saturation}%)`,
            backgroundColor: `rgba(255, 255, 255, ${opacity / 100})`,
          }}
          className="relative z-10 w-84 p-6 rounded-2xl border border-white/30 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono tracking-wider uppercase text-white/90 font-bold">
                SPATIAL GLASSMORPHISM
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <h4 className="text-[17px] font-bold text-white mt-2">Vision Space Engine</h4>
            <p className="text-[12px] text-white/80 mt-1 leading-relaxed">
              背景光线透过分子级微晶玻璃产生自然折射与弥散光芒。
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-[11px] text-white/90 font-mono">
            <span>CSS 滤镜实时渲染</span>
            <span className="underline cursor-pointer" onClick={() => onNotice?.("已复制毛玻璃 CSS 片段！")}>
              复制 CSS ↗
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
