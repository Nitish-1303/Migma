window.Migma = window.Migma || {};

Migma.ui = (() => {
  const React = Spicetify.React;
  const h = React.createElement;
  const cx = (...p) => p.filter(Boolean).join(" ");

  // "dark" and "light" are honoured verbatim;
  const LIGHT_QUERY = "(prefers-color-scheme: light)";

  const prefersLight = () => {
    try {
      return window.matchMedia(LIGHT_QUERY).matches;
    } catch (e) {
      return false;
    }
  };

  const resolveTheme = pref =>
    pref === "light" || pref === "dark" ? pref : prefersLight() ? "light" : "dark";

  function useTheme(pref) {
    const [theme, setTheme] = React.useState(() => resolveTheme(pref));

    React.useEffect(() => {
      setTheme(resolveTheme(pref));
      if (pref !== "system") return undefined;

      let mq;
      try {
        mq = window.matchMedia(LIGHT_QUERY);
      } catch (e) {
        return undefined;
      }
      const onChange = () => setTheme(prefersLight() ? "light" : "dark");
      if (mq.addEventListener) {
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
      }
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }, [pref]);

    return theme;
  }

  const Btn = ({ variant = "primary", size, block, disabled, onClick, title, children }) =>
    h(
      "button",
      {
        type: "button",
        className: cx(
          "mg-btn",
          variant !== "primary" && `mg-btn--${variant}`,
          size === "sm" && "is-sm",
          block && "is-block"
        ),
        disabled,
        title,
        onClick
      },
      children
    );

  const Chip = ({ tone, on, disabled, title, onClick, children }) =>
    h(
      onClick ? "button" : "span",
      {
        type: onClick ? "button" : undefined,
        className: cx("mg-chip", on && "is-on", tone && `mg-chip--${tone}`),
        // A chip that carries state announces it; one that is only a label stays silent.
        "aria-pressed": onClick && on !== undefined ? Boolean(on) : undefined,
        disabled: onClick ? disabled : undefined,
        title,
        onClick
      },
      children
    );

  const Field = ({ label, hint, children }) =>
    h(
      "div",
      { className: "mg-field" },
      label && h("label", { className: "mg-lbl" }, label),
      children,
      hint && h("p", { className: "mg-hint" }, hint)
    );

  const Input = props => h("input", Object.assign({ className: "mg-inp", spellCheck: false }, props));

  const Select = ({ value, onChange, options, disabled, size, ariaLabel }) =>
    h(
      "select",
      {
        className: cx("mg-inp", "mg-select", size === "sm" && "is-sm"),
        value,
        disabled,
        "aria-label": ariaLabel,
        onChange: e => onChange(e.target.value)
      },
      options.map(o => h("option", { key: o.value, value: o.value }, o.label))
    );
  const Seg = ({ value, options, onChange }) =>
    h(
      "div",
      { className: "mg-seg", role: "radiogroup" },
      options.map(o =>
        h(
          "button",
          {
            key: o.value,
            type: "button",
            role: "radio",
            "aria-checked": o.value === value,
            className: cx("mg-seg__i", o.value === value && "is-on"),
            onClick: () => onChange(o.value)
          },
          o.label
        )
      )
    );

  const Toggle = ({ on, label, onChange }) =>
    h(
      "button",
      {
        type: "button",
        role: "switch",
        "aria-checked": Boolean(on),
        "aria-label": label,
        className: cx("mg-tog", on && "is-on"),
        onClick: () => onChange(!on)
      },
      h("b", null)
    );

  const Tile = ({ value, label }) =>
    h("div", { className: "mg-tile" }, h("b", null, value), h("s", null, label));

  const Bar = ({ label, share, peak }) =>
    h(
      "div",
      { className: "mg-bar" },
      h("em", { title: label }, label),
      h("span", { className: "mg-bar__tr" }, h("b", { style: { width: `${Math.max(4, (share / (peak || 100)) * 100)}%` } })),
      h("u", null, `${share}%`)
    );

  const Spark = ({ items }) =>
    h(
      "div",
      { className: "mg-spark" },
      items.map(it =>
        h("i", { key: it.label, style: { height: `${Math.max(4, it.share)}%` } }, h("s", null, it.label))
      )
    );
  const Spinner = () => h("i", { className: "mg-spin", role: "progressbar" });

  const Skeleton = ({ width, height }) =>
    h("div", { className: "mg-sk", style: { width: width || "100%", height: height || 11 } });

  // One continuous rail rather than a row of boxes.
  const Rail = ({ steps, index, onJump }) =>
    h(
      "div",
      { className: "mg-rail" },
      h(
        "div",
        {
          className: "mg-rail__tr",
          role: "progressbar",
          "aria-valuemin": 1,
          "aria-valuemax": steps.length,
          "aria-valuenow": index + 1,
          "aria-label": `Step ${index + 1} of ${steps.length}: ${steps[index].label}`
        },
        h("b", { style: { width: `${((index + 1) / steps.length) * 100}%` } })
      ),
      h(
        "div",
        { className: "mg-rail__ls" },
        steps.map((s, i) => {
          const back = i < index && Boolean(onJump);
          return h(
            back ? "button" : "span",
            {
              key: s.value,
              type: back ? "button" : undefined,
              className: cx("mg-rail__s", i < index && "is-done", i === index && "is-on"),
              "aria-current": i === index ? "step" : undefined,
              title: back ? `Back to ${s.label}` : undefined,
              onClick: back ? () => onJump(i) : undefined
            },
            h("i", { "aria-hidden": "true" }, i < index ? "✓" : i + 1),
            s.label
          );
        })
      )
    );

  const StateView = ({ glyph, tone, title, note, meta, action }) =>
    h(
      "div",
      { className: "mg-state" },
      h("i", { className: cx("mg-glyph", tone && `mg-glyph--${tone}`) }, glyph),
      h("b", null, title),
      note && h("p", null, note),
      action,
      meta && h("span", { className: "mg-state__meta" }, meta)
    );

  const Row = ({ label, value }) =>
    h("div", { className: "mg-kv" }, h("span", null, label), h("span", null, value));

  return {
    React,
    h,
    cx,
    resolveTheme,
    useTheme,
    Btn,
    Chip,
    Field,
    Input,
    Select,
    Seg,
    Toggle,
    Tile,
    Bar,
    Spark,
    Spinner,
    Skeleton,
    Rail,
    StateView,
    Row
  };
})();

