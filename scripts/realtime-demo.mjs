import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const WAIT_MS = Number(process.env.WAIT_MS ?? 1500);
const sameRoom = process.argv.includes('--same-room');

async function http(method, path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(process.env.ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
}

function connect(userId) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, { auth: { userId }, transports: ['websocket'], reconnection: false });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

async function join(socket, orderId) {
    const ack = await socket.timeout(2000).emitWithAck('join', { orderId });
    if (!ack.ok) throw new Error(`join orders:${orderId} rejected: ${ack.error}`);
    return ack.room;
}

function countEvents(socket, orderId) {
    const received = [];
    socket.on('order.status', (event) => {
        if (event.orderId === orderId) received.push(event);
    });
    return received;
}

const { items } = await http('GET', '/orders?limit=100');
const orderA = items[0];
const orderB = items.find((o) => o.buyerId !== orderA?.buyerId);
if (!orderA || !orderB) {
    console.error('demo: потрібні два замовлення різних покупців — запусти npm run seed');
    process.exit(1);
}

const roomOrderB = sameRoom ? orderA : orderB;
const expectedB = sameRoom ? 1 : 0;

const clientA = await connect(orderA.buyerId);
const clientB = await connect(roomOrderB.buyerId);
const sockets = [clientA, clientB];

try {
    const roomA = await join(clientA, orderA.id);
    const roomB = await join(clientB, roomOrderB.id);
    console.log(`demo: A=user ${orderA.buyerId} in ${roomA}, B=user ${roomOrderB.buyerId} in ${roomB}${sameRoom ? ' (--same-room)' : ''}`);

    const foreign = await connect(orderB.buyerId);
    sockets.push(foreign);
    const foreignAck = await foreign.timeout(2000).emitWithAck('join', { orderId: orderA.id });
    console.log(`FOREIGN_JOIN=${foreignAck.ok ? 'accepted' : foreignAck.error}`);

    const receivedA = countEvents(clientA, orderA.id);
    const receivedB = countEvents(clientB, orderA.id);

    const current = await http('GET', `/orders/${orderA.id}`);
    const next = current.status === 'shipped' ? 'paid' : 'shipped';
    const event = await http('PATCH', `/orders/${orderA.id}/status`, { status: next });
    console.log(`demo: order ${orderA.id} ${event.previousStatus} → ${event.status} (event id ${event.id})`);

    await new Promise((r) => setTimeout(r, WAIT_MS));

    const a = receivedA.length > 0 ? 1 : 0;
    const b = receivedB.length > 0 ? 1 : 0;
    console.log(`A_RECEIVED=${a}`);
    console.log(`B_RECEIVED=${b}`);

    process.exitCode = a === 1 && b === expectedB && !foreignAck.ok ? 0 : 1;
} catch (e) {
    console.error(`demo: ${e.message}`);
    process.exitCode = 1;
} finally {
    sockets.forEach((s) => s.close());
}
