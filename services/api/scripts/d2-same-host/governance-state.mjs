import { join } from 'node:path'
import {
  ERROR_CODES, canonicalJson, fail, parseManifestPayload, sha256,
} from './governance-contract.mjs'

export const FACET_ORDER = Object.freeze(['task', 'branch', 'baseline', 'clone', 'evidence', 'archive'])
const HASH = /^[0-9a-f]{64}$/u
const RESERVATION_ID = /^[0-9a-f]{32}$/u
const EVENT_ID = /^[0-9a-f]{16}-[0-9a-f]{32}$/u
const EVENT_KINDS = new Set(['RESERVE_INTENT', 'RESERVED', 'INVOKED'])

function exactObject(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid record')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('invalid record')
  }
  return value
}
function timestamp(value) {
  if (typeof value !== 'string') throw new Error('invalid timestamp')
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error('invalid timestamp')
  return value
}
function validateIntent(record) {
  const value = exactObject(record.value, [
    'schemaVersion', 'kind', 'reservationId', 'manifestDigest', 'createdAt',
  ])
  if (value.schemaVersion !== 1 || value.kind !== 'RESERVATION_INTENT' ||
    !RESERVATION_ID.test(value.reservationId) || !HASH.test(value.manifestDigest) ||
    timestamp(value.createdAt) !== value.createdAt ||
    record.path !== join('reservations', 'by-reservation', `${value.reservationId}.json`)) {
    throw new Error('invalid reservation intent')
  }
  return Object.freeze({ ...value, path: record.path })
}
function validateIdentity(record, facet) {
  const value = exactObject(record.value, [
    'schemaVersion', 'kind', 'facet', 'identityHash', 'reservationId', 'manifestDigest', 'createdAt',
  ])
  if (value.schemaVersion !== 1 || value.kind !== 'IDENTITY' || value.facet !== facet ||
    !HASH.test(value.identityHash) || !RESERVATION_ID.test(value.reservationId) ||
    !HASH.test(value.manifestDigest) || timestamp(value.createdAt) !== value.createdAt ||
    record.path !== join('reservations', `by-${facet}`, `${value.identityHash}.json`)) {
    throw new Error('invalid identity')
  }
  return Object.freeze({ ...value, path: record.path })
}
function validateEvent(record) {
  const value = exactObject(record.value, [
    'schemaVersion', 'eventId', 'kind', 'outcome', 'reservationId', 'identityHashes', 'createdAt',
  ])
  const identityHashes = exactObject(value.identityHashes, FACET_ORDER)
  if (value.schemaVersion !== 1 || !EVENT_ID.test(value.eventId) || !EVENT_KINDS.has(value.kind) ||
    value.outcome !== 'RECORDED' || !RESERVATION_ID.test(value.reservationId) ||
    FACET_ORDER.some((facet) => !HASH.test(identityHashes[facet])) ||
    timestamp(value.createdAt) !== value.createdAt ||
    record.path !== join('events', `${value.eventId}.json`)) throw new Error('invalid event')
  return Object.freeze({
    ...value, identityHashes: Object.freeze({ ...identityHashes }), path: record.path,
  })
}
function validateInvocation(record) {
  const value = exactObject(record.value, [
    'schemaVersion', 'kind', 'reservationId', 'manifestDigest', 'createdAt',
  ])
  if (value.schemaVersion !== 1 || value.kind !== 'INVOCATION' ||
    !RESERVATION_ID.test(value.reservationId) || !HASH.test(value.manifestDigest) ||
    timestamp(value.createdAt) !== value.createdAt ||
    record.path !== join('invocations', `${value.reservationId}.json`)) {
    throw new Error('invalid invocation')
  }
  return Object.freeze({ ...value, path: record.path })
}
function putUnique(map, key, value) {
  if (map.has(key)) throw new Error('duplicate governance record')
  map.set(key, value)
}
function sameHashes(left, right) {
  return FACET_ORDER.every((facet) => left[facet] === right[facet])
}
function readonlyMap(source) {
  let view
  view = {
    get size() { return source.size },
    get: (key) => source.get(key),
    has: (key) => source.has(key),
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    forEach: (callback, thisArg) => source.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => source[Symbol.iterator](),
  }
  return Object.freeze(view)
}

export function loadGovernanceState(state) {
  try {
    const reservations = new Map(); const identities = new Map(); const manifests = new Map()
    const events = new Map(); const invocations = new Map()
    for (const record of state.records) {
      if (record.path.startsWith(`${join('reservations', 'by-reservation')}/`)) {
        const intent = validateIntent(record)
        putUnique(reservations, intent.reservationId, intent)
        continue
      }
      const facet = FACET_ORDER.find((name) =>
        record.path.startsWith(`${join('reservations', `by-${name}`)}/`))
      if (facet) {
        const identity = validateIdentity(record, facet)
        putUnique(identities, `${facet}:${identity.identityHash}`, identity)
        continue
      }
      if (record.path.startsWith('manifests/')) {
        const payload = parseManifestPayload(record.value)
        if (record.path !== join('manifests', `${payload.reservationId}.json`)) {
          throw new Error('manifest path')
        }
        putUnique(manifests, payload.reservationId, Object.freeze({
          payload, digest: sha256(canonicalJson(payload)), path: record.path,
        }))
        continue
      }
      if (record.path.startsWith('events/')) {
        const event = validateEvent(record)
        putUnique(events, event.eventId, event)
        continue
      }
      if (record.path.startsWith('invocations/')) {
        const invocation = validateInvocation(record)
        putUnique(invocations, invocation.reservationId, invocation)
        continue
      }
      throw new Error('unknown governance record')
    }

    const identitiesByReservation = new Map()
    for (const identity of identities.values()) {
      const intent = reservations.get(identity.reservationId)
      if (!intent || intent.manifestDigest !== identity.manifestDigest ||
        intent.createdAt !== identity.createdAt) throw new Error('orphan identity')
      const owned = identitiesByReservation.get(identity.reservationId) ?? new Map()
      if (owned.has(identity.facet)) throw new Error('duplicate reservation facet')
      owned.set(identity.facet, identity)
      identitiesByReservation.set(identity.reservationId, owned)
    }

    const eventsByReservation = new Map()
    for (const event of events.values()) {
      const intent = reservations.get(event.reservationId)
      if (!intent) throw new Error('orphan event')
      const owned = eventsByReservation.get(event.reservationId) ?? new Map()
      if (owned.has(event.kind)) throw new Error('duplicate event kind')
      owned.set(event.kind, event)
      eventsByReservation.set(event.reservationId, owned)
      const facets = identitiesByReservation.get(event.reservationId) ?? new Map()
      for (const [facet, identity] of facets) {
        if (event.identityHashes[facet] !== identity.identityHash) throw new Error('event identity drift')
      }
    }

    for (const [reservationId, intent] of reservations) {
      const facets = identitiesByReservation.get(reservationId) ?? new Map()
      let missingFacet = false
      for (const facet of FACET_ORDER) {
        if (!facets.has(facet)) missingFacet = true
        else if (missingFacet) throw new Error('non-prefix reservation facets')
      }
      const reservationEvents = eventsByReservation.get(reservationId) ?? new Map()
      const intentEvent = reservationEvents.get('RESERVE_INTENT')
      if (facets.size > 0 && !intentEvent) throw new Error('identity without intent event')
      if (intentEvent && intentEvent.createdAt !== intent.createdAt) throw new Error('intent event time')
      if (!manifests.has(reservationId)) {
        if (reservationEvents.has('RESERVED') || reservationEvents.has('INVOKED') ||
          invocations.has(reservationId)) throw new Error('post-manifest record without manifest')
      }
    }

    for (const [reservationId, manifest] of manifests) {
      const intent = reservations.get(reservationId)
      const facets = identitiesByReservation.get(reservationId) ?? new Map()
      const reservationEvents = eventsByReservation.get(reservationId) ?? new Map()
      const intentEvent = reservationEvents.get('RESERVE_INTENT')
      if (!intent || manifest.digest !== intent.manifestDigest ||
        manifest.payload.createdAt !== intent.createdAt || facets.size !== FACET_ORDER.length ||
        !intentEvent || !sameHashes(manifest.payload.identityHashes, intentEvent.identityHashes)) {
        throw new Error('invalid manifest relation')
      }
      for (const facet of FACET_ORDER) {
        const identity = facets.get(facet)
        if (!identity || identity.identityHash !== manifest.payload.identityHashes[facet] ||
          identity.manifestDigest !== manifest.digest) throw new Error('missing manifest facet')
      }
      const reservedEvent = reservationEvents.get('RESERVED')
      if (reservedEvent && (reservedEvent.createdAt !== intent.createdAt ||
        !sameHashes(reservedEvent.identityHashes, manifest.payload.identityHashes))) {
        throw new Error('invalid reserved event')
      }
    }

    const completeReservations = new Map()
    for (const [reservationId, manifest] of manifests) {
      if (eventsByReservation.get(reservationId)?.has('RESERVED')) {
        completeReservations.set(reservationId, manifest)
      }
    }
    for (const [reservationId, invocation] of invocations) {
      const manifest = completeReservations.get(reservationId)
      if (!manifest || invocation.manifestDigest !== manifest.digest) throw new Error('orphan invocation')
      const invokedEvent = eventsByReservation.get(reservationId)?.get('INVOKED')
      if (invokedEvent && (invokedEvent.createdAt !== invocation.createdAt ||
        !sameHashes(invokedEvent.identityHashes, manifest.payload.identityHashes))) {
        throw new Error('invalid invoked event')
      }
    }
    for (const event of events.values()) {
      if (event.kind === 'RESERVED' && !completeReservations.has(event.reservationId)) {
        throw new Error('reserved event without complete reservation')
      }
      if (event.kind === 'INVOKED' && !invocations.has(event.reservationId)) {
        throw new Error('invoked event without invocation')
      }
    }

    return Object.freeze({
      stateRoot: state.root,
      records: state.records,
      reservations: readonlyMap(reservations),
      identities: readonlyMap(identities),
      manifests: readonlyMap(manifests),
      events: readonlyMap(events),
      invocations: readonlyMap(invocations),
      completeReservations: readonlyMap(completeReservations),
    })
  } catch { fail(ERROR_CODES.LEDGER) }
}
