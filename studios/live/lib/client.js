window.__ModuleLoader__.load({id:"dsh-studio-live",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/sdk/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// <define:STUDIO_PROJECT>
var define_STUDIO_PROJECT_default = { schemaVersion: 1, id: "live", name: "\u76F4\u64AD\u5DE5\u4F5C\u5BA4", icon: "\u{1F399}\uFE0F", description: "AI \u6E38\u620F\u76F4\u64AD\uFF1Adsh \u6A21\u578B\u3001B\u7AD9\u5F39\u5E55\u3001VRM \u4E0E\u4E91\u7AEF\u8BED\u97F3\u3001OBS \u548C\u6E38\u620F\u9002\u914D", order: 16, entry: "/studio-projects/live", capabilities: ["local-preview", "dsh-session", "danmaku-bridge", "obs-overlay", "stardew-adapter", "bilibili-danmaku", "vrm-avatar", "cloud-tts", "minecraft-adapter"], compatibility: { host: "0.2.2-rc.1", runtime: "^0.5.0", worktable: "^0.6.0" } };

// packages/sdk/client.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function ProjectCard(props) {
  const { project, reportMeta } = props;
  const id = "studio-" + project.id;
  (0, import_react.useEffect)(() => {
    reportMeta?.({ id, name: project.name, icon: project.icon });
  }, [id, project, reportMeta]);
  const name = props.nameOverrides?.[id] ?? project.name;
  const icon = props.iconOverrides?.[id] ?? project.icon;
  if (props.hidden?.includes(id) || props.query && !name.toLocaleLowerCase().includes(props.query.toLocaleLowerCase())) return null;
  const position = props.order?.indexOf(id) ?? -1;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "sp:relative sp:flex sp:h-[34px] sp:w-full sp:items-center sp:gap-1.5 sp:rounded-(--dsw-radius-md) sp:border-0 sp:bg-transparent sp:px-2 sp:text-left sp:text-sm sp:leading-5 sp:text-(--dsw-alias-label-primary) sp:cursor-pointer sp:hover:bg-(--dsw-alias-interactive-bg-hover) sp:data-[on=true]:bg-(--dsw-alias-interactive-bg-hover)",
      "data-worktable-project": id,
      "data-on": props.activeSplitId === id ? "true" : "false",
      style: { order: position < 0 ? 1e3 : position },
      title: project.description,
      onClick: () => {
        props.openSplit?.({ id, title: name, icon, top: null, main: [{ id: id + "-main", title: name, min: 300, content: { kind: "iframe", url: "/studio-projects/" + project.id, title: name } }], chatWidth: { default: 340, min: 260, max: 640 } });
        props.reportUsed?.(id);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sp:flex sp:w-4 sp:shrink-0 sp:items-center sp:justify-center", children: icon }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "sp:min-w-0 sp:flex-1 sp:truncate", children: name })
      ]
    }
  );
}
var inject = ["slots"];
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n@layer properties;\n@layer theme, utilities;\n@layer theme {\n  :root, :host {\n    --sp-spacing: 0.25rem;\n    --sp-text-sm: 0.875rem;\n    --sp-text-sm--line-height: calc(1.25 / 0.875);\n  }\n}\n@layer utilities {\n  .sp\\:relative {\n    position: relative;\n  }\n  .sp\\:flex {\n    display: flex;\n  }\n  .sp\\:h-\\[34px\\] {\n    height: 34px;\n  }\n  .sp\\:w-4 {\n    width: calc(var(--sp-spacing) * 4);\n  }\n  .sp\\:w-full {\n    width: 100%;\n  }\n  .sp\\:min-w-0 {\n    min-width: 0px;\n  }\n  .sp\\:flex-1 {\n    flex: 1;\n  }\n  .sp\\:shrink-0 {\n    flex-shrink: 0;\n  }\n  .sp\\:cursor-pointer {\n    cursor: pointer;\n  }\n  .sp\\:items-center {\n    align-items: center;\n  }\n  .sp\\:justify-center {\n    justify-content: center;\n  }\n  .sp\\:gap-1\\.5 {\n    gap: calc(var(--sp-spacing) * 1.5);\n  }\n  .sp\\:truncate {\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n  .sp\\:rounded-\\(--dsw-radius-md\\) {\n    border-radius: var(--dsw-radius-md);\n  }\n  .sp\\:border-0 {\n    border-style: var(--tw-border-style);\n    border-width: 0px;\n  }\n  .sp\\:bg-transparent {\n    background-color: transparent;\n  }\n  .sp\\:px-2 {\n    padding-inline: calc(var(--sp-spacing) * 2);\n  }\n  .sp\\:text-left {\n    text-align: left;\n  }\n  .sp\\:text-sm {\n    font-size: var(--sp-text-sm);\n    line-height: var(--tw-leading, var(--sp-text-sm--line-height));\n  }\n  .sp\\:leading-5 {\n    --tw-leading: calc(var(--sp-spacing) * 5);\n    line-height: calc(var(--sp-spacing) * 5);\n  }\n  .sp\\:text-\\(--dsw-alias-label-primary\\) {\n    color: var(--dsw-alias-label-primary);\n  }\n  @media (hover: hover) {\n    .sp\\:hover\\:bg-\\(--dsw-alias-interactive-bg-hover\\):hover {\n      background-color: var(--dsw-alias-interactive-bg-hover);\n    }\n  }\n  .sp\\:data-\\[on\\=true\\]\\:bg-\\(--dsw-alias-interactive-bg-hover\\)[data-on="true"] {\n    background-color: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n@property --tw-border-style {\n  syntax: "*";\n  inherits: false;\n  initial-value: solid;\n}\n@property --tw-leading {\n  syntax: "*";\n  inherits: false;\n}\n@layer properties {\n  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color:rgb(from red r g b)))) {\n    *, ::before, ::after, ::backdrop {\n      --tw-border-style: solid;\n      --tw-leading: initial;\n    }\n  }\n}\n';
    document.head.appendChild(style);
    return () => style.remove();
  }, "\u5DE5\u4F5C\u5BA4\u9879\u76EE\uFF1A\u5361\u7247\u6837\u5F0F");
  const project = define_STUDIO_PROJECT_default;
  ctx.slots.inject("sidebar.worktable.project", () => ctx.slots.register({ name: "sidebar.worktable.project", id: "studio-" + project.id, order: 16, inject: () => ({ project }) }, ProjectCard), "\u5DE5\u4F5C\u5BA4\u9879\u76EE\uFF1A" + project.name);
}
return module.exports;}});
