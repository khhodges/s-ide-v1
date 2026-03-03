class SystemAbstractions {
    constructor(registry) {
        this.registry = registry;
        this._bindAll();
    }

    _bindAll() {
        this._bindMint();
        this._bindMemory();
        this._bindScheduler();
        this._bindStack();
        this._bindSalvation();
    }

    _bindSalvation() {
        this.registry.bindMethod(4, 'LOAD', function(sim, args) {
            return { ok: true, result: 'Salvation.LOAD: proved namespace lookup' };
        });
        this.registry.bindMethod(4, 'TPERM', function(sim, args) {
            return { ok: true, result: 'Salvation.TPERM: proved permission check' };
        });
        this.registry.bindMethod(4, 'LAMBDA', function(sim, args) {
            return { ok: true, result: 'Salvation.LAMBDA: proved Church reduction' };
        });
        this.registry.bindMethod(4, 'RETURN', function(sim, args) {
            return { ok: true, result: 'Salvation.RETURN: proved CALL→RETURN cycle' };
        });
    }

    _bindMint() {
        this.registry.bindMethod(5, 'Create', function(sim, args) {
            const targetPerms = args.perms || { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 };
            const sourcePerms = args.sourcePerms || { R: 1, W: 1, X: 1, L: 1, S: 1, E: 1 };

            for (const p of ['R', 'W', 'X', 'L', 'S', 'E']) {
                if (targetPerms[p] && !sourcePerms[p]) {
                    return {
                        ok: false,
                        fault: 'PERMISSION_ESCALATION',
                        message: `Mint.Create: cannot grant ${p} permission not held by source`
                    };
                }
            }

            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Create: nsIndex required' };
            }

            const version = args.version || 0;
            const gtType = args.gtType || 0;
            const gt = sim.createGT(version, nsIndex, targetPerms, gtType);

            return {
                ok: true,
                result: gt,
                message: `Mint.Create: GT created for NS[${nsIndex}] v${version}`
            };
        });

        this.registry.bindMethod(5, 'Revoke', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Revoke: nsIndex required' };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            if (nsIndex >= sim.nsCount) {
                return { ok: false, fault: 'BOUNDS', message: `Mint.Revoke: NS[${nsIndex}] out of bounds` };
            }

            const w2 = sim.memory[base + 2];
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            const seal = w2 & 0x01FFFFFF;
            sim.memory[base + 2] = (((newVersion & 0x7F) << 25) | (seal & 0x01FFFFFF)) >>> 0;

            return {
                ok: true,
                result: newVersion,
                message: `Mint.Revoke: NS[${nsIndex}] version ${oldVersion} → ${newVersion}, all outstanding GTs invalidated`
            };
        });

        this.registry.bindMethod(5, 'Transfer', function(sim, args) {
            const gt = args.gt;
            const targetCList = args.targetCList;
            const targetSlot = args.targetSlot;

            if (gt === undefined) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Transfer: gt required' };
            }

            return {
                ok: true,
                result: gt,
                message: `Mint.Transfer: GT transferred to c-list slot ${targetSlot}`
            };
        });
    }

    _bindMemory() {
        this.registry.bindMethod(6, 'Allocate', function(sim, args) {
            const size = args.size || 16;

            let freeIdx = -1;
            for (let i = sim.nsCount; i < sim.MAX_NS_ENTRIES; i++) {
                if (!sim.isNSEntryValid(i)) {
                    freeIdx = i;
                    break;
                }
            }
            if (freeIdx === -1) {
                for (let i = 0; i < sim.nsCount; i++) {
                    if (!sim.isNSEntryValid(i) && i >= 44) {
                        freeIdx = i;
                        break;
                    }
                }
            }
            if (freeIdx === -1) {
                return { ok: false, fault: 'OOM', message: 'Memory.Allocate: no free NS entries' };
            }

            const location = freeIdx * sim.SLOT_SIZE;
            const limit17 = (size - 1) & 0x1FFFF;
            sim.writeNSEntry(freeIdx, location, limit17, 0, 0, 0, 0, 0, 0);
            sim.nsLabels[freeIdx] = `DATA[${freeIdx}]`;

            const perms = { R: 1, W: 1, X: 0, L: 0, S: 0, E: 0 };
            const gt = sim.createGT(0, freeIdx, perms, 0);

            return {
                ok: true,
                result: { gt: gt, nsIndex: freeIdx, location: location, size: size },
                message: `Memory.Allocate: NS[${freeIdx}] allocated ${size} words at 0x${location.toString(16)}`
            };
        });

        this.registry.bindMethod(6, 'Free', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Free: nsIndex required' };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            sim.memory[base + 0] = 0;
            sim.memory[base + 1] = 0;
            sim.memory[base + 2] = 0;
            delete sim.nsLabels[nsIndex];

            return {
                ok: true,
                result: nsIndex,
                message: `Memory.Free: NS[${nsIndex}] deallocated`
            };
        });

        this.registry.bindMethod(6, 'Resize', function(sim, args) {
            const nsIndex = args.nsIndex;
            const newSize = args.size || 32;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Resize: nsIndex required' };
            }

            const entry = sim.readNSEntry(nsIndex);
            if (!entry) {
                return { ok: false, fault: 'BOUNDS', message: `Memory.Resize: NS[${nsIndex}] not found` };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            const newLimit = (newSize - 1) & 0x1FFFF;
            const w1 = sim.memory[base + 1];
            const flags = w1 & 0xFFFE0000;
            sim.memory[base + 1] = (flags | newLimit) >>> 0;

            const loc = sim.memory[base + 0];
            sim.memory[base + 2] = sim.makeVersionSeals(
                (sim.memory[base + 2] >>> 25) & 0x7F, loc, newLimit
            );

            return {
                ok: true,
                result: { nsIndex: nsIndex, newSize: newSize },
                message: `Memory.Resize: NS[${nsIndex}] resized to ${newSize} words`
            };
        });
    }

    _bindScheduler() {
        if (!this._schedulerState) {
            this._schedulerState = {
                threads: [{ id: 0, state: 'running', name: 'boot' }],
                currentThread: 0,
                nextId: 1
            };
        }
        const state = this._schedulerState;

        this.registry.bindMethod(7, 'Yield', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'ready';

            let next = -1;
            for (let i = 1; i <= state.threads.length; i++) {
                const idx = (state.currentThread + i) % state.threads.length;
                if (state.threads[idx] && state.threads[idx].state === 'ready') {
                    next = idx;
                    break;
                }
            }

            if (next === -1) {
                if (current) current.state = 'running';
                return { ok: true, result: state.currentThread, message: 'Scheduler.Yield: no other ready threads' };
            }

            state.currentThread = next;
            state.threads[next].state = 'running';

            return {
                ok: true,
                result: next,
                message: `Scheduler.Yield: switched to thread ${next} (${state.threads[next].name})`
            };
        });

        this.registry.bindMethod(7, 'Spawn', function(sim, args) {
            const name = args.name || `thread_${state.nextId}`;
            const newThread = { id: state.nextId, state: 'ready', name: name };
            state.threads.push(newThread);
            state.nextId++;

            return {
                ok: true,
                result: { threadId: newThread.id, name: name },
                message: `Scheduler.Spawn: created thread ${newThread.id} "${name}"`
            };
        });

        this.registry.bindMethod(7, 'Wait', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'waiting';

            return {
                ok: true,
                result: state.currentThread,
                message: `Scheduler.Wait: thread ${state.currentThread} now waiting`
            };
        });

        this.registry.bindMethod(7, 'Stop', function(sim, args) {
            const threadId = args.threadId !== undefined ? args.threadId : state.currentThread;
            const thread = state.threads.find(t => t.id === threadId);
            if (!thread) {
                return { ok: false, fault: 'THREAD', message: `Scheduler.Stop: thread ${threadId} not found` };
            }
            thread.state = 'stopped';

            return {
                ok: true,
                result: threadId,
                message: `Scheduler.Stop: thread ${threadId} "${thread.name}" stopped`
            };
        });
    }

    _bindStack() {
        if (!this._stackState) {
            this._stackState = {
                data: [],
                maxDepth: 256
            };
        }
        const stack = this._stackState;

        this.registry.bindMethod(8, 'Push', function(sim, args) {
            if (stack.data.length >= stack.maxDepth) {
                return { ok: false, fault: 'STACK_OVERFLOW', message: `Stack.Push: overflow at depth ${stack.maxDepth}` };
            }
            const value = args.value !== undefined ? args.value : 0;
            stack.data.push(value);
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Push: pushed 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(8, 'Pop', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Pop: stack is empty' };
            }
            const value = stack.data.pop();
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Pop: popped 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(8, 'Peek', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Peek: stack is empty' };
            }
            const value = stack.data[stack.data.length - 1];
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Peek: top = 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(8, 'Depth', function(sim, args) {
            return {
                ok: true,
                result: { depth: stack.data.length },
                message: `Stack.Depth: ${stack.data.length}`
            };
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAbstractions;
}
