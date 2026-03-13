const TangSerial = (function() {
    let port = null;

    const BAUD = 115200;
    const NS_WORDS = 192;
    const CLIST_WORDS = 64;
    const TOTAL_WORDS = NS_WORDS + CLIST_WORDS;

    function isSupported() {
        return 'serial' in navigator;
    }

    function isConnected() {
        return port !== null && port.readable !== null && port.writable !== null;
    }

    async function ensureOpen() {
        if (!port) {
            throw new Error('No port selected. Call connect() first.');
        }
        if (port.readable && port.writable) {
            return;
        }
        await port.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none' });
    }

    async function connect() {
        if (!isSupported()) {
            throw new Error('WebSerial not supported. Use Chrome or Edge to connect to your Tang Nano 20K.');
        }

        if (port) {
            try {
                if (port.readable) {
                    const r = port.readable.getReader();
                    r.releaseLock();
                }
                if (port.writable) {
                    const w = port.writable.getWriter();
                    w.releaseLock();
                }
                await port.close();
            } catch(e) {}
            port = null;
            await new Promise(r => setTimeout(r, 200));
        }

        port = await navigator.serial.requestPort({
            filters: []
        });
        await ensureOpen();
    }

    async function disconnect() {
        if (port) {
            try { await port.close(); } catch(e) {}
            port = null;
        }
    }

    function wordToLE(word) {
        const buf = new Uint8Array(4);
        buf[0] = word & 0xFF;
        buf[1] = (word >>> 8) & 0xFF;
        buf[2] = (word >>> 16) & 0xFF;
        buf[3] = (word >>> 24) & 0xFF;
        return buf;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function drainInput() {
        if (!port || !port.readable) return;
        const r = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 100))
                ]);
                if (done || !value) break;
            }
        } catch(e) {}
        finally { try { r.releaseLock(); } catch(e) {} }
    }

    async function uploadToFPGA(nsWords, clistWords, onStatus) {
        const status = onStatus || function() {};

        if (!isConnected()) {
            throw new Error('Not connected. Call connect() first — make sure your Tang Nano 20K is plugged in via USB-C.');
        }

        await drainInput();

        const totalWords = NS_WORDS + CLIST_WORDS;
        const payload = new Uint8Array(4 + totalWords * 4);

        const header = wordToLE(totalWords);
        payload.set(header, 0);

        for (let i = 0; i < NS_WORDS; i++) {
            const w = i < nsWords.length ? nsWords[i] : 0;
            payload.set(wordToLE(w >>> 0), 4 + i * 4);
        }

        for (let i = 0; i < CLIST_WORDS; i++) {
            const w = i < clistWords.length ? clistWords[i] : 0;
            payload.set(wordToLE(w >>> 0), 4 + (NS_WORDS + i) * 4);
        }

        status(`Sending ${payload.length} bytes (${totalWords} words) to Tang Nano 20K via BL616...`);

        const w = port.writable.getWriter();
        try {
            await w.write(payload);
        } finally {
            w.releaseLock();
        }

        status('Data sent to BL616. Waiting for FPGA response...');

        const rxBytes = [];
        const deadline = Date.now() + 5000;

        const r = port.readable.getReader();
        try {
            while (Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    r.read(),
                    new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), 2000))
                ]);
                if (done || !value || value.length === 0) break;
                for (let i = 0; i < value.length; i++) rxBytes.push(value[i]);
            }
        } catch(e) {
            status('Read error: ' + e.message);
        } finally {
            try { r.releaseLock(); } catch(e) {}
        }

        const rxTotal = rxBytes.length;
        const rxHex = rxBytes.slice(0, 32).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const rxAscii = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(rxBytes));

        const hasTextOK   = /CHURCH|HALT|OK|DONE|ACK|BOOT|READY/i.test(rxAscii);
        const hasBinaryAck = rxBytes.length > 0 && rxBytes[0] === 0x06;
        const echoMatch   = rxTotal >= 4 && rxBytes[0] === (payload[0]) && rxBytes[1] === (payload[1]);

        const success = rxTotal > 0;

        if (rxTotal === 0) {
            status('No response from FPGA. Check baud rate and reset timing.');
        } else {
            status(`Received ${rxTotal} byte${rxTotal === 1 ? '' : 's'} from FPGA.`);
            if (rxHex) status(`  RX[0..${Math.min(rxTotal,32)-1}]: ${rxHex}`);
            const printable = rxAscii.replace(/[^\x20-\x7E\r\n]/g, '.').trim();
            if (printable) status(`  ASCII: ${printable.substring(0, 120)}`);
            if (hasTextOK)   status('  ✓ Recognised boot banner in response.');
            else if (hasBinaryAck) status('  ✓ Binary ACK (0x06) received.');
            else if (echoMatch)    status('  ✓ Echo match — FPGA echoed header back.');
            else status('  Response is binary (no text banner). FPGA is alive.');
        }

        return { success, rxTotal, rxHex, lines: rxAscii.split(/\r?\n/).map(l => l.trim()).filter(Boolean) };
    }

    return {
        isSupported,
        isConnected,
        connect,
        disconnect,
        uploadToFPGA,
        NS_WORDS,
        CLIST_WORDS,
        TOTAL_WORDS
    };
})();
