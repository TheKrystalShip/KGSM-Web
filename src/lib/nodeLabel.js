// nodeLabel.js — what to call a node in front of a person.
//
// Every surface that names a node asks the same question and used to answer it separately, each ending
// in `|| id`. An id is a routing key, not a name: when one is missing the fallback printed the internal
// placeholder the realtime store files an unreconciled connection under, so a banner told people they had
// "lost the live connection to _cold-boot". A person cannot act on that, and it reads as a fault in a
// machine that does not exist.
//
// The chain is: the host's own reported name, then the label stored with the connection, then its address
// — an address is a poor name but a true one somebody can recognise. Only if all of those are missing does
// this give up, and it gives up by saying so rather than by printing a key.

import { CONNECTIONS } from "./config.js";

// The address without its scheme — "kgsm.thekrystalship.com", not "https://kgsm.thekrystalship.com/".
// Long enough to identify, short enough to sit in a sentence.
function addressOf(url) {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).host || null;
  } catch {
    return null;
  }
}

// nodeLabel(id, hosts) — hosts is hostsStore's list; pass what the caller already holds.
//
// A caller with no id at all is the unreconciled connection: at that point there is exactly one node it
// could be, so name that one. Past N=1 there is nothing honest to say and the caller should not be
// naming anything.
export function nodeLabel(id, hosts) {
  const conn = id
    ? CONNECTIONS.find(c => c.id === id)
    : (CONNECTIONS.length === 1 ? CONNECTIONS[0] : null);

  const host = id && Array.isArray(hosts) ? hosts.find(h => h.id === id) : null;
  if (host && host.name) return host.name;
  if (conn && conn.name) return conn.name;

  const address = addressOf(conn && conn.url);
  if (address) return address;

  // Nothing names it. "this host" is true, and it is what a person would say.
  return "this host";
}

// Whether an id refers to a node this browser is actually driving. The realtime store keys an
// unreconciled connection under a placeholder, and a surface that lists nodes by name should not present
// that placeholder as one — at N=1 the app-wide connection banner is already telling that story.
export function isNamedNode(id) {
  return !!id && CONNECTIONS.some(c => c.id === id);
}
