"use strict";

// studios/live/src/minecraft-worker.ts
var import_node_worker_threads = require("node:worker_threads");
var import_mineflayer = require("mineflayer");
var port = import_node_worker_threads.parentPort;
if (!port) throw new Error("Minecraft \u9002\u914D\u5668\u53EA\u80FD\u7531\u5DE5\u4F5C\u5BA4\u542F\u52A8");
var config = import_node_worker_threads.workerData;
var bot = (0, import_mineflayer.createBot)({ host: "127.0.0.1", port: config.port, username: config.username, auth: "offline", hideErrors: true, logErrors: false });
var ready = false;
var busy = false;
var stop = () => {
  bot.clearControlStates();
  bot.stopDigging();
};
bot.once("spawn", () => {
  ready = true;
  port.postMessage({ type: "ready" });
});
bot.on("error", () => port.postMessage({ type: "failure", error: "Minecraft \u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A Java \u6D4B\u8BD5\u670D" }));
bot.on("end", () => {
  ready = false;
  port.postMessage({ type: "failure", error: "Minecraft \u8FDE\u63A5\u5DF2\u65AD\u5F00" });
});
bot.on("kicked", () => {
  ready = false;
  port.postMessage({ type: "failure", error: "Minecraft \u670D\u52A1\u5668\u62D2\u7EDD\u8FDE\u63A5\uFF0C\u8BF7\u68C0\u67E5\u7248\u672C\u548C\u6D4B\u8BD5\u670D\u8BBE\u7F6E" });
});
function snapshot() {
  const position = bot.entity.position;
  const nearby = bot.findBlocks({ matching: (block) => /(?:log|stone|ore|crafting_table)$/u.test(block.name), maxDistance: 8, count: 12 }).map((value) => {
    const block = bot.blockAt(value);
    return { name: block?.name, x: value.x, y: value.y, z: value.z };
  });
  return { connected: ready, game: "minecraft-java", health: bot.health, food: bot.food, position: { x: position.x, y: position.y, z: position.z }, inventory: bot.inventory.items().map((item) => ({ name: item.name, count: item.count })), nearby, at: Date.now() };
}
async function act(action) {
  stop();
  if (action === "wait" || action === "stop") return;
  if (action === "lookLeft" || action === "lookRight") {
    await bot.look(bot.entity.yaw + (action === "lookLeft" ? 0.5 : -0.5), 0, true);
    return;
  }
  if (["forward", "back", "left", "right", "jump"].includes(action)) {
    if (action === "forward") {
      const next = bot.entity.position.offset(-Math.sin(bot.entity.yaw), -1, -Math.cos(bot.entity.yaw));
      const ground = bot.blockAt(next);
      if (!ground || ["air", "lava", "water"].includes(ground.name)) throw new Error("\u524D\u65B9\u7F3A\u5C11\u5B89\u5168\u5730\u9762\uFF0C\u672C\u8F6E\u672A\u79FB\u52A8");
    }
    bot.setControlState(action, true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    stop();
    return;
  }
  if (action === "digLog" || action === "digStone") {
    const block = bot.findBlock({ matching: (value) => action === "digLog" ? /(?:_log|_stem)$/u.test(value.name) : value.name === "stone", maxDistance: 3 });
    if (!block || !bot.canDigBlock(block) || block.position.y < Math.floor(bot.entity.position.y)) throw new Error("\u9644\u8FD1\u6CA1\u6709\u53EF\u4EE5\u5B89\u5168\u6316\u6398\u7684\u76EE\u6807\uFF0C\u672C\u8F6E\u672A\u6316\u6398");
    await bot.dig(block);
    return;
  }
  throw new Error("Minecraft \u52A8\u4F5C\u4E0D\u5728\u5141\u8BB8\u5217\u8868");
}
port.on("message", (request) => {
  if (request.action === "stop") stop();
  if (!ready || busy && request.action !== "stop") {
    port.postMessage({ id: request.id, error: ready ? "Minecraft \u6B63\u5728\u6267\u884C\u4E0A\u4E00\u6761\u52A8\u4F5C" : "Minecraft \u5C1A\u672A\u8FDB\u5165\u4E16\u754C" });
    return;
  }
  busy = true;
  const deadline = setTimeout(() => {
    stop();
    bot.quit();
    port.postMessage({ type: "failure", error: "Minecraft \u52A8\u4F5C\u8D85\u65F6\uFF0C\u5DF2\u65AD\u5F00\u8FDE\u63A5\uFF0C\u8BF7\u68C0\u67E5\u6E38\u620F\u72B6\u6001\u540E\u91CD\u65B0\u9884\u6F14" });
  }, 5e3);
  void (async () => {
    try {
      if (request.action !== "state") await act(request.action);
      port.postMessage({ id: request.id, state: snapshot() });
    } catch (error) {
      port.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Minecraft \u52A8\u4F5C\u5931\u8D25" });
    } finally {
      clearTimeout(deadline);
      busy = false;
    }
  })();
});
