// capacity.js — will this server fit on its node, as far as the panel can tell?
//
// KGSM refuses a start that would leave the node with less free memory than its configured floor. That
// refusal arrives AFTER the click, from inside the job, and is the engine's to make. This is the half
// that can be known beforehand: what the server is expected to need, what its node has free, and the
// floor the operator configured — the same three numbers the gate compares.
//
// THIS IS A PREDICTION, AND THE UI MUST TREAT IT AS ONE. The reading is a moment old, the requirement
// may be a vendor estimate, and the engine re-decides at the instant it acts. So nothing here disables
// a control: a wrongly-refused start strands an operator with no way forward, while a wrongly-allowed
// one is caught by the gate itself, which is the whole point of having a gate. What this drives is a
// WARNING and a confirm step — see ServerActions' arming behaviour.
//
// The relationship is the one verbGuard already has with the backend's CommandGate: the client predicts
// so the surface can explain itself, and the authority decides.

/// The capacity picture for one server on one node, or null when there is nothing honest to say.
///
/// Returns null — meaning "show nothing" — whenever any input is missing, and the missing inputs are
/// the common case rather than an edge:
///   · the server declares no requirement (no memory_cap_mb, no blueprint min_ram_mb — most games),
///   · the host reports no MemAvailable reading,
///   · the node publishes no gate policy (an engine that did not answer, or config predating the gate),
///   · the gate is switched off, in which case nothing will be refused and a warning would be a lie.
///
/// Never substitutes a default for any of them. A guessed requirement or an assumed floor would put an
/// invented warning in front of a real start.
function capacityHint(server, host) {
  if (!server || !host) return null;

  // Number.isFinite, NOT a `>= 0` comparison. `null >= 0` is TRUE in JavaScript — null coerces to 0 —
  // so a comparison guard lets an absent reading through as a free node with zero memory, which is the
  // exact opposite of the honest answer and would warn about every server on a host the monitor cannot
  // see. Each of these is genuinely absent most of the time, so the guard has to actually hold.
  const requiredMb = server.start_memory_mb;
  if (!Number.isFinite(requiredMb) || requiredMb <= 0) return null;

  const gate = host.memory_gate;
  if (!gate || !gate.enabled) return null;

  const headroomMb = gate.headroom_mb;
  if (!Number.isFinite(headroomMb) || headroomMb < 0) return null;

  const freeMb = host.ram ? host.ram.free_mb : null;
  if (!Number.isFinite(freeMb) || freeMb < 0) return null;

  const remainingMb = freeMb - requiredMb;
  return {
    requiredMb,
    freeMb,
    headroomMb,
    remainingMb,
    // Which figure the requirement is, so a surface can say how much to trust it: "cap" is the cgroup
    // ceiling the watchdog enforces, "blueprint" is a vendor estimate.
    source: server.start_memory_source || null,
    // What the engine would decide on these numbers. Named `tight` rather than `refused` on purpose —
    // this is what the panel expects, not what happened.
    tight: remainingMb < headroomMb,
  };
}

/// Would a start of this server look refused right now? False whenever the question cannot be answered,
/// so a caller can use it directly to decide whether to warn.
function startLooksTight(server, host) {
  const hint = capacityHint(server, host);
  return !!(hint && hint.tight);
}

/// The hint as one short sentence, for a card or a button's title.
///
/// Deliberately states the two figures and NOT a verdict: "needs 8 GB · 2 GB free" lets an operator see
/// the shape of the problem — and decide the estimate is wrong — where "cannot start" would assert
/// something this client is not entitled to assert.
function capacityText(hint) {
  if (!hint) return null;
  return "Needs " + gb(hint.requiredMb) + " · " + gb(hint.freeMb) + " free";
}

/// The fuller sentence, for a confirm step that has room for it. Names the floor as well, because the
/// floor is why a start with apparently-spare memory is still refused.
function capacityDetail(hint) {
  if (!hint) return null;
  const source = hint.source === "blueprint"
    // Worth saying: an operator who knows this game runs in less is exactly who should override, and
    // they can only judge that if they know the figure is an estimate rather than a measurement.
    ? " (its blueprint's estimate)"
    : "";
  return "This server expects " + gb(hint.requiredMb) + source
    + ", the node has " + gb(hint.freeMb) + " free, and "
    + gb(hint.headroomMb) + " must stay free.";
}

// MB → a short human figure. Whole gibibytes above 1 GB, megabytes below, because "0.4 GB" reads worse
// than "410 MB" and a server's floor is often in the hundreds.
function gb(mb) {
  if (mb == null) return "—";
  if (mb < 1024) return Math.round(mb) + " MB";
  const v = mb / 1024;
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + " GB";
}

export { capacityDetail, capacityHint, capacityText, startLooksTight };
