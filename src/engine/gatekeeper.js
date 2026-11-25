// src/gatekeeper.js
// Single Task: Gatekeeper State Machine & Sequence ID Queue Manager

export class Gatekeeper {
    constructor() {
        this.workerBusy = false;
        this.pendingRequest = null;
        this.currentSequenceId = 0;
    }

    nextSequence() {
        this.currentSequenceId++;
        return this.currentSequenceId;
    }

    isCurrentSequence(sequenceId) {
        return this.currentSequenceId === sequenceId;
    }

    shouldQueue(startIndex) {
        if (this.workerBusy) {
            this.pendingRequest = startIndex;
            return true; // Queued!
        }
        this.workerBusy = true;
        return false; // Free to process!
    }

    unlock() {
        this.workerBusy = false;
        const next = this.pendingRequest;
        this.pendingRequest = null;
        return next;
    }

    reset() {
        this.workerBusy = false;
        this.pendingRequest = null;
    }
}