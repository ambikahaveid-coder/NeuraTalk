import net from "net";

const port = Number(process.argv[2] || 6389);
const store = new Map();
const expiries = new Map();

function now() {
  return Date.now();
}

function clearExpired(key) {
  const expiresAt = expiries.get(key);
  if (expiresAt && expiresAt <= now()) {
    expiries.delete(key);
    store.delete(key);
  }
}

function bulk(value) {
  if (value === null || value === undefined) {
    return "$-1\r\n";
  }

  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

function simple(value) {
  return `+${value}\r\n`;
}

function integer(value) {
  return `:${Number(value)}\r\n`;
}

function array(values) {
  const items = values ?? [];
  return `*${items.length}\r\n${items.map((item) => bulk(item)).join("")}`;
}

function error(message) {
  return `-ERR ${message}\r\n`;
}

function parseCommands(buffer) {
  const commands = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer[offset] !== 42) {
      break;
    }

    const endOfCount = buffer.indexOf("\r\n", offset);
    if (endOfCount === -1) {
      break;
    }

    const argCount = Number(buffer.slice(offset + 1, endOfCount));
    if (!Number.isFinite(argCount)) {
      break;
    }

    let cursor = endOfCount + 2;
    const args = [];
    let complete = true;

    for (let i = 0; i < argCount; i += 1) {
      if (buffer[cursor] !== 36) {
        complete = false;
        break;
      }

      const endOfLength = buffer.indexOf("\r\n", cursor);
      if (endOfLength === -1) {
        complete = false;
        break;
      }

      const size = Number(buffer.slice(cursor + 1, endOfLength));
      const start = endOfLength + 2;
      const end = start + size;
      if (buffer.length < end + 2) {
        complete = false;
        break;
      }

      args.push(buffer.slice(start, end));
      cursor = end + 2;
    }

    if (!complete) {
      break;
    }

    commands.push(args);
    offset = cursor;
  }

  return {
    commands,
    remaining: buffer.slice(offset),
  };
}

function readValue(key) {
  clearExpired(key);
  return store.get(key);
}

function handleCommand(args) {
  const command = (args[0] || "").toUpperCase();

  if (command === "PING") {
    return args[1] ? bulk(args[1]) : simple("PONG");
  }

  if (command === "ECHO") {
    return bulk(args[1] || "");
  }

  if (command === "QUIT") {
    return simple("OK");
  }

  if (command === "INFO") {
    return bulk("# Server\r\nredis_version:7.0.0\r\n");
  }

  if (command === "CLIENT") {
    return simple("OK");
  }

  if (command === "HELLO") {
    return array(["server", "redis", "version", "7.0.0", "proto", "3", "id", "1", "mode", "standalone", "role", "master"]);
  }

  if (command === "SET") {
    const key = args[1];
    const value = args[2] ?? "";
    store.set(key, value);
    expiries.delete(key);

    for (let i = 3; i < args.length; i += 1) {
      const option = args[i]?.toUpperCase();
      if ((option === "EX" || option === "PX") && args[i + 1]) {
        const ttl = Number(args[i + 1]);
        const ms = option === "EX" ? ttl * 1000 : ttl;
        expiries.set(key, now() + ms);
        i += 1;
      }
    }

    return simple("OK");
  }

  if (command === "SETEX") {
    const key = args[1];
    const ttl = Number(args[2] || 0) * 1000;
    const value = args[3] ?? "";
    store.set(key, value);
    expiries.set(key, now() + ttl);
    return simple("OK");
  }

  if (command === "GET") {
    return bulk(readValue(args[1]));
  }

  if (command === "MGET") {
    return array(args.slice(1).map((key) => readValue(key)));
  }

  if (command === "DEL" || command === "UNLINK") {
    let removed = 0;
    for (const key of args.slice(1)) {
      clearExpired(key);
      if (store.delete(key)) {
        expiries.delete(key);
        removed += 1;
      }
    }
    return integer(removed);
  }

  if (command === "EXISTS") {
    let count = 0;
    for (const key of args.slice(1)) {
      if (readValue(key) !== undefined) {
        count += 1;
      }
    }
    return integer(count);
  }

  if (command === "EXPIRE" || command === "PEXPIRE") {
    const key = args[1];
    if (readValue(key) === undefined) {
      return integer(0);
    }

    const ttl = Number(args[2] || 0);
    const ms = command === "EXPIRE" ? ttl * 1000 : ttl;
    expiries.set(key, now() + ms);
    return integer(1);
  }

  if (command === "TTL" || command === "PTTL") {
    const key = args[1];
    if (readValue(key) === undefined) {
      return integer(-2);
    }

    const expiresAt = expiries.get(key);
    if (!expiresAt) {
      return integer(-1);
    }

    const remaining = Math.max(expiresAt - now(), 0);
    return integer(command === "TTL" ? Math.ceil(remaining / 1000) : remaining);
  }

  if (command === "INCR") {
    const key = args[1];
    const current = Number(readValue(key) || 0) + 1;
    store.set(key, String(current));
    return integer(current);
  }

  if (command === "DECR") {
    const key = args[1];
    const current = Number(readValue(key) || 0) - 1;
    store.set(key, String(current));
    return integer(current);
  }

  if (command === "HSET") {
    const key = args[1];
    const current = readValue(key);
    const hash = current && typeof current === "object" ? current : {};
    let created = 0;

    for (let i = 2; i < args.length; i += 2) {
      const field = args[i];
      const value = args[i + 1] ?? "";
      if (!(field in hash)) {
        created += 1;
      }
      hash[field] = value;
    }

    store.set(key, hash);
    return integer(created);
  }

  if (command === "HGET") {
    const key = args[1];
    const field = args[2];
    const hash = readValue(key);
    return bulk(hash?.[field] ?? null);
  }

  if (command === "HGETALL") {
    const hash = readValue(args[1]) || {};
    const values = [];
    for (const [field, value] of Object.entries(hash)) {
      values.push(field, value);
    }
    return array(values);
  }

  if (command === "HDEL") {
    const key = args[1];
    const hash = readValue(key);
    if (!hash || typeof hash !== "object") {
      return integer(0);
    }

    let removed = 0;
    for (const field of args.slice(2)) {
      if (field in hash) {
        delete hash[field];
        removed += 1;
      }
    }
    store.set(key, hash);
    return integer(removed);
  }

  if (command === "SCAN") {
    return array(["0"]);
  }

  if (command === "KEYS") {
    return array([...store.keys()]);
  }

  if (command === "EVAL") {
    return integer(0);
  }

  if (command === "FLUSHALL" || command === "FLUSHDB") {
    store.clear();
    expiries.clear();
    return simple("OK");
  }

  return simple("OK");
}

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    const parsed = parseCommands(buffer);
    buffer = parsed.remaining;

    for (const args of parsed.commands) {
      const response = handleCommand(args);
      socket.write(response);

      if ((args[0] || "").toUpperCase() === "QUIT") {
        socket.end();
      }
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake redis listening on 127.0.0.1:${port}`);
});
