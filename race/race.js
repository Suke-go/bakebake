// Story race, archive edition: the race of src/components/YokaiRace.tsx and
// src/lib/archive-race-server.ts in one static page. data.json (export_archive_edition.py) holds
// a few puzzles per level and the stories around their routes, so links, moves left and the
// look-back are all worked out here. Nothing is sent anywhere; progress stays in this browser.
(async function () {
    'use strict';
    const LETTERS = 'ABCDEFGHIJ';
    const UNLOCK_AFTER = 2;                       // puzzles to clear in a level before the next one opens
    const PROGRESS_KEY = 'archive-race-edition-v1';
    const CARD_BASE = 'https://www.nichibun.ac.jp/cgi-bin/YoukaiDB3/youkai_card.cgi?ID=';
    const app = document.getElementById('app'), map = document.getElementById('map');

    const getJson = url => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(url)));
    let D, JP;
    try { [D, JP] = await Promise.all([getJson('data.json'), getJson('japan.json')]); }
    catch { app.innerHTML = '<p role="alert">ゲームのデータを読み込めませんでした。</p>'; return; }

    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = n => n.toLocaleString('ja-JP');
    const short = name => (name || '').split(/[；;，,、]/)[0].replace(/[（(].*?[)）]/g, '').trim();

    // ---------------------------------------------------------------- stories and links
    const N = D.nodes.length;
    const stories = D.nodes.map(([recordId, name, key, prefecture, lat, lng, bits, summary], node) => {
        const opening = summary.normalize('NFKC').slice(0, 14);
        return { node, recordId, key, prefecture, coordinates: [lng, lat], summary,
            name: short(name) || (opening ? `「${opening}…」` : key || '名のない話'),
            landscape: D.landscape.filter((_, k) => bits & (1 << k)) };
    });
    const label = s => `${esc(s.name)}（${esc(s.prefecture)}）`;

    /** Straight line between the two story places, whole km. */
    function km(a, b) {
        const [lng1, lat1] = a.coordinates.map(x => x * Math.PI / 180), [lng2, lat2] = b.coordinates.map(x => x * Math.PI / 180);
        const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2;
        return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
    }

    function shared(from, to) {
        const k = D.edges[from].indexOf(to), a = stories[from], b = stories[to];
        return { shared: k >= 0 ? D.facets[from][k] || [] : [], hint: k >= 0 ? D.hints[from][k] || '' : '', sharedLandscape: a.landscape.filter(x => b.landscape.includes(x)) };
    }

    // Moves left to finish a puzzle from each story. State = (story, detour prefectures visited so
    // far, the story's own included); a backward breadth-first search from (target, all visited).
    const incoming = Array.from({ length: N }, () => []);
    for (let u = 0; u < N; u++) for (const v of new Set([...D.edges[u], ...D.fill[u]])) if (v !== u) incoming[v].push(u);
    const tables = new Map();
    function table(puzzle) {
        if (tables.has(puzzle.id)) return tables.get(puzzle.id);
        const detours = puzzle.detours.map(d => d.prefecture);
        const bits = node => { const k = detours.indexOf(stories[node].prefecture); return k < 0 ? 0 : 1 << k; };
        const masks = 1 << detours.length, full = masks - 1;
        const dist = new Int16Array(N * masks).fill(-1), queue = new Int32Array(N * masks);
        let head = 0, tail = 0;
        dist[puzzle.target * masks + full] = 0; queue[tail++] = puzzle.target * masks + full;
        while (head < tail) {
            const state = queue[head++], v = Math.floor(state / masks), m = state % masks, d = dist[state];
            const from = v === puzzle.target ? [...incoming[v], ...puzzle.near] : incoming[v];
            for (const u of from) {
                if (u === puzzle.target) continue;   // the target ends the route
                const bu = bits(u);
                for (const m0 of new Set([m, m & ~bits(v)])) {
                    if ((m0 | bits(v)) !== m || (m0 & bu) !== bu) continue;
                    const s = u * masks + m0;
                    if (dist[s] < 0) { dist[s] = d + 1; queue[tail++] = s; }
                }
            }
        }
        const t = { bits, masks, dist };
        tables.set(puzzle.id, t);
        return t;
    }

    /** One story's links for a puzzle. Stories from which the target can no longer be reached inside
     *  this edition are left out; the target itself stays, shown locked until the detours are done. */
    function entry(node, puzzle, done) {
        const { bits, masks, dist } = table(puzzle);
        const m = done | bits(node), here = dist[node * masks + m];
        const left = j => dist[j * masks + (m | bits(j))];
        const open = l => l.node === puzzle.target || left(l.node) >= 0;
        const mark = l => { const d = left(l.node); if (here > 0 && d >= 0 && d < here) l.closer = true; return l; };
        const links = D.edges[node].map(j => mark({ ...stories[j], ...shared(node, j) })).filter(open);
        if (puzzle.near.includes(node) && !links.some(l => l.node === puzzle.target)) links.push({ ...stories[puzzle.target], ...shared(node, puzzle.target), near: true });
        const fill = D.fill[node].map(j => mark({ ...stories[j], ...shared(node, j), fill: true })).filter(open);
        return { here: stories[node], remaining: here < 0 ? null : here, links, fill };
    }

    /** offerFrom of src/lib/archive-race.ts: at most one card with the current story's name, no two
     *  cards with the same name, filler stories before a name may repeat. */
    function offerFrom(links, here, keyOf, visited, count, fill) {
        const open = links.filter(j => !visited.has(j));
        const picked = [], used = new Set();
        let sameAsHere = 0;
        for (const pool of [open, fill.filter(j => !visited.has(j))]) {
            for (const j of pool) {
                if (picked.length === count) return picked;
                if (picked.includes(j)) continue;
                const key = keyOf(j), sameHere = key !== '' && key === here;
                if ((key !== '' && used.has(key)) || (sameHere && sameAsHere >= 1)) continue;
                picked.push(j);
                if (key !== '') used.add(key);
                if (sameHere) sameAsHere++;
            }
        }
        for (const j of open) {
            if (picked.length === count) break;
            if (!picked.includes(j)) picked.push(j);
        }
        return picked;
    }

    function offer(current, visited, puzzle) {
        const linked = current.links.filter(l => !l.near), fill = current.fill;
        const byNode = new Map([...fill, ...linked].map(l => [l.node, l]));
        const cards = offerFrom(linked.map(l => l.node), current.here.key, j => byNode.get(j).key, visited, D.offeredCards, fill.map(l => l.node)).map(j => byNode.get(j));
        // The target seen nearby joins as an extra card.
        const near = current.links.find(l => l.near);
        const all = near && !cards.some(c => c.node === near.node) ? [...cards, near] : cards;
        // At least one card lowers the moves left.
        const closers = [...linked, ...fill].filter(l => l.closer && !visited.has(l.node));
        const kept = new Set(cards.slice(0, -1).map(c => c.key).filter(Boolean));
        const toward = closers.find(l => !l.key || !kept.has(l.key)) || closers[0];
        if (toward && !all.some(c => c.closer)) all.splice(Math.max(0, cards.length - 1), cards.length ? 1 : 0, toward);
        // Only in this edition: moves left are counted inside the kept stories, so the card that lowers
        // them can differ from the full race's. The guide's own next story is kept on offer, so that
        // the guide's route shown in the look-back can always be played here.
        const g = puzzle.guidePath, next = g.map((n, k) => n === current.here.node ? g[k + 1] : undefined)
            .find(n => n !== undefined && !visited.has(n) && byNode.has(n) && !all.some(c => c.node === n));
        if (next !== undefined) {
            const regular = all.filter(c => !c.near), last = regular.reverse().find(c => c !== toward) || regular[0];
            if (regular.length < D.offeredCards || !last) all.push(byNode.get(next));
            else all[all.indexOf(last)] = byNode.get(next);
        }
        return all;
    }

    function hops(route, puzzle) {
        const out = [];
        for (let i = 1; i < route.length; i++) {
            const u = route[i - 1], v = route[i];
            const linked = D.edges[u].includes(v) || D.fill[u].includes(v);
            const near = !linked && v === puzzle.target && puzzle.near.includes(u);
            const back = !linked && !near;
            const from = stories[u], to = stories[v];
            out.push({ from, to, back, near, ...(back ? { shared: [], hint: '', sharedLandscape: [] } : shared(u, v)), km: km(from, to), prefectureChanged: from.prefecture !== to.prefecture });
        }
        return out;
    }
    const totalKm = list => list.reduce((sum, h) => sum + h.km, 0);

    /** The look-back: the player's moves next to the shortest route and the guide's. */
    function lookBack(puzzle, route) {
        const seen = new Set(route.slice(0, -1).map(n => stories[n].prefecture));
        const detours = puzzle.detours.map(d => ({ ...d, visited: seen.has(d.prefecture) }));
        const mine = hops(route, puzzle), guideRoute = hops(puzzle.guidePath, puzzle);
        return { reached: route[route.length - 1] === puzzle.target && detours.every(d => d.visited), detours,
            km: totalKm(mine), guideKm: totalKm(guideRoute), mine, shortestRoute: hops(puzzle.optimalPath, puzzle), guideRoute };
    }

    /** The sentence of a story that holds the shared words, split around them so they can be marked. */
    function hintSentence(summary, hint) {
        if (!hint) return null;
        const text = summary.normalize('NFKC'), at = text.indexOf(hint);
        if (at < 0) return null;
        const ends = /[。！？!?]/g;
        let start = 0, end = text.length, m;
        while ((m = ends.exec(text))) {
            if (m.index < at) start = m.index + 1;
            else { end = m.index + 1; break; }
        }
        const from = Math.max(start, at - 40), to = Math.min(end, at + hint.length + 50);
        return [(from > start ? '…' : '') + text.slice(from, at).trimStart(), hint, text.slice(at + hint.length, to) + (to < end ? '…' : '')];
    }

    // ---------------------------------------------------------------- state
    function readProgress() { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; } }
    function writeProgress(p) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* progress stays for this visit only */ } }
    let progress = readProgress();
    const cleared = level => level.puzzles.filter(p => progress[p.id] !== undefined).length;
    const unlocked = level => level.level === 1 || cleared(D.levels[level.level - 2]) >= UNLOCK_AFTER;

    /** s: the puzzle in play. stack is where the player stands (back pops it); route is every move. */
    let s = null, review = null, shownRoute = 'mine', lastRemaining = null, trend = null;
    const doneBits = () => s.puzzle.detours.reduce((bits, d, k) => s.seen.has(d.prefecture) ? bits | (1 << k) : bits, 0);
    const detoursLeft = () => s.puzzle.detours.filter(d => !s.seen.has(d.prefecture)).map(d => d.prefecture);

    function start(level, after) {
        const from = after ? level.puzzles.findIndex(p => p.id === after.id) + 1 : 0;
        const order = [...level.puzzles.slice(from), ...level.puzzles.slice(0, from)];
        const puzzle = order.find(p => progress[p.id] === undefined && p !== after) || order[0];
        s = { level, puzzle, stack: [puzzle.start], route: [puzzle.start], travelled: 0, seen: new Set([stories[puzzle.start].prefecture]) };
        review = null; shownRoute = 'mine'; lastRemaining = null; trend = null;
        render(true);
    }

    function move(link) {
        const here = stories[s.stack[s.stack.length - 1]];
        if (link.node === s.puzzle.target && detoursLeft().length) return;
        s.route.push(link.node); s.travelled += km(here, link); s.seen.add(link.prefecture);
        if (link.node === s.puzzle.target) { finish(true); return; }
        s.stack.push(link.node);
        render(true);
    }

    function back() {
        if (s.stack.length < 2) return;
        const here = stories[s.stack.pop()], to = stories[s.stack[s.stack.length - 1]];
        s.route.push(to.node); s.travelled += km(here, to);
        render(true);
    }

    function finish(reached) {
        if (reached) {
            const moves = s.route.length - 1, before = progress[s.puzzle.id];
            progress = { ...readProgress(), [s.puzzle.id]: { moves: Math.min(moves, before ? before.moves : Infinity), km: Math.min(s.travelled, before ? before.km : Infinity) } };
            writeProgress(progress);
        }
        review = lookBack(s.puzzle, s.route);
        render(true);
    }

    // ---------------------------------------------------------------- panel
    const DISTANCE_NOTE = '<p class="note">距離は話が記録された地点どうしの直線距離です。多くの話は都道府県の代表地点に置かれているので、同じ県の中の移動はたいてい0kmになります。</p>';
    const storyBox = (s, tag, cls) => `<div class="story ${cls}"><span class="tag">${tag}</span><strong>${esc(s.name)}</strong><span class="place">${esc(s.prefecture)}</span><p>${esc(s.summary)}</p>${
        cls === 'target' && s.landscape.length ? `<small>この話の地勢：${esc(s.landscape.join('・'))}</small>` : ''}</div>`;
    const detourLine = done => s.puzzle.detours.length ? `<p class="detours">寄り道：${s.puzzle.detours.map(d => `<span data-done="${done(d)}">${done(d) ? '✓ ' : ''}${esc(d.prefecture)}</span>`).join(' ・ ')}</p>` : '';

    let offered = [];
    function cardOf(o, here) {
        const isTarget = o.node === s.puzzle.target, left = detoursLeft(), wait = isTarget && left.length > 0;
        const sentence = hintSentence(o.summary, o.hint);
        return { km: km(here, o), detour: left.includes(o.prefecture), target: isTarget, locked: wait,
            note: isTarget ? (wait ? `目的の話です。先に寄り道（${left.join('・')}）へ` : o.near ? '目的の話がすぐ近くに見えます' : '目的の話です') : '',
            text: sentence ? `${esc(sentence[0])}<mark>${esc(sentence[1])}</mark>${esc(sentence[2])}` : esc(o.summary.slice(0, 80)) + (o.summary.length > 80 ? '…' : ''),
            land: o.sharedLandscape.length ? `どちらも${o.sharedLandscape.join('・')}` : '' };
    }

    function renderLevels() {
        app.innerHTML = `<p class="lead">似ている話を候補から選んでたどり、目的の話にたどり着いてください。段階2からは、途中で寄る県（寄り道）が決まっていて、そこを通ってからでないと目的の話には入れません。移動した距離も数えるので、案内役より短い旅を目指してみてください。候補は地図上のピン（A〜F）にもなります。着いたら、たどった道を地図で振り返ります。</p>
<ol class="levels">${D.levels.map(l => {
        const open = unlocked(l);
        return `<li><button data-act="level" data-level="${l.level}"${open ? '' : ' disabled'}><span class="no">段階${l.level}</span><strong>${esc(l.title)}</strong><small>${
            open ? `${l.detours ? `寄り道${l.detours}つ ・ ` : ''}案内役なら${l.guideMoves[0] === l.guideMoves[1] ? l.guideMoves[0] : `${l.guideMoves[0]}〜${l.guideMoves[1]}`}手 ・ クリア ${cleared(l)} / ${l.puzzles.length}` : `段階${l.level - 1}を${UNLOCK_AFTER}問クリアすると開きます`}</small></button></li>`;
    }).join('')}</ol>
<p class="note">クリアの記録はこのブラウザの中だけに残ります。操作はどこにも送られません。</p>`;
    }

    function renderPlay() {
        const node = s.stack[s.stack.length - 1], current = entry(node, s.puzzle, doneBits());
        offered = offer(current, new Set(s.route), s.puzzle);
        if (current.remaining !== null) {
            trend = { left: current.remaining, delta: lastRemaining === null ? null : current.remaining - lastRemaining };
            lastRemaining = current.remaining;
        } else trend = null;
        const cards = offered.map((o, i) => {
            const c = cardOf(o, current.here);
            return `<button class="card" data-act="move" data-i="${i}" data-target="${c.target}"${c.locked ? ' disabled' : ''}><span class="letter">${LETTERS[i]}</span>
<span><strong>${esc(o.name)}</strong><span class="place">${esc(o.prefecture)}</span><span class="km">+${num(c.km)}km</span>${c.detour ? '<span class="detourTag">寄り道の県</span>' : ''}</span>
${c.note ? `<span class="found">${esc(c.note)}</span>` : ''}<span class="text">${c.text}</span>${c.land ? `<span class="land">${esc(c.land)}</span>` : ''}</button>`;
        }).join('');
        app.innerHTML = `<p class="status">段階${s.level.level}「${esc(s.level.title)}」・ ${s.route.length - 1}手目 ・ 移動 ${num(s.travelled)}km ・ 案内役なら${s.puzzle.guideMoves}手・${num(s.puzzle.guideKm)}km</p>
${trend ? `<p class="trend" data-delta="${trend.delta === null ? 'start' : Math.sign(trend.delta)}">目的まで最短であと<strong>${trend.left}</strong>手${trend.delta === null ? '' : `<span>${trend.delta < 0 ? '近づいた' : trend.delta > 0 ? '離れた' : '変わらず'}</span>`}</p>` : ''}
${detourLine(d => s.seen.has(d.prefecture))}
${storyBox(stories[s.puzzle.target], '目的の話', 'target')}
${storyBox(current.here, 'いまの話', 'here')}
<h2 class="choose">次に読む話</h2>
<div class="cards">${cards}</div>
${offered.length ? '' : '<p>この話から先の未読の話はありません。戻ってください。</p>'}
<div class="controls"><button data-act="back"${s.stack.length < 2 ? ' disabled' : ''}>← 戻る（1手）</button><button data-act="giveup">あきらめて振り返る</button><button data-act="levels">段階を選ぶ</button></div>
${DISTANCE_NOTE}`;
        drawPlay(current.here);
    }

    const routeOf = name => name === 'mine' ? review.mine : name === 'shortest' ? review.shortestRoute : review.guideRoute;
    const stopsOf = list => list.length ? [list[0].from, ...list.map(h => h.to)] : [];

    function renderReview() {
        const list = routeOf(shownRoute), level = s.level, nextLevel = D.levels[level.level];
        const forward = review.mine.map((h, i) => ({ h, i })).filter(x => !x.h.back);
        const farthest = forward.reduce((best, x) => (!best || x.h.km > best.h.km ? x : best), null);
        const prefectures = new Set(stopsOf(review.mine).map(x => x.prefecture)).size || 1;
        const landscapeShare = forward.length ? Math.round(100 * forward.filter(x => x.h.sharedLandscape.length).length / forward.length) : 0;
        const nowOpen = nextLevel && cleared(level) >= UNLOCK_AFTER;
        const marks = [['到着', review.reached], ['案内役の手数以内', review.reached && review.mine.length <= s.puzzle.guideMoves], ['案内役の距離以内', review.reached && review.km <= review.guideKm]];
        app.innerHTML = `<h2 class="result">${review.reached ? `${review.mine.length}手・${num(review.km)}kmで到着` : '途中で振り返り'}</h2>
<p class="marks">${marks.map(([text, ok]) => `<span data-ok="${ok}">${ok ? '★' : '☆'} ${text}</span>`).join('')}</p>
<p class="compare">案内役 ${s.puzzle.guideMoves}手・${num(review.guideKm)}km ・ 最短 ${s.puzzle.shortest}手</p>
${detourLine(d => review.detours.find(x => x.prefecture === d.prefecture).visited)}
<p class="stats">${prefectures}都道府県をめぐりました。一番遠い跳躍は${farthest ? `${label(farthest.h.from)}→ ${label(farthest.h.to)}の${num(farthest.h.km)}km` : 'ありません'}。地勢が同じ話へ進んだ手は${landscapeShare}%。</p>
${DISTANCE_NOTE}
${storyBox(stories[s.puzzle.target], '目的の話', 'target')}
<nav class="routeTabs" aria-label="地図に重ねる道">${[['mine', 'あなたの道'], ['shortest', '最短の道'], ['guide', '案内役の道']].map(([name, text]) =>
            `<button data-act="route" data-route="${name}" aria-pressed="${shownRoute === name}">${text}</button>`).join('')}</nav>
<p class="note">${shownRoute === 'mine' ? '金色の線があなたの道です。' : '金色があなたの道、青い点線が比べる道です。'}話を開くと本文と原資料へのリンクが出ます。</p>
<ol class="hops">${list.map((h, i) => `<li data-back="${h.back}" data-farthest="${shownRoute === 'mine' && farthest !== null && farthest.i === i}"><details><summary><span class="names">${label(h.from)}→ ${label(h.to)}</span>
<span class="meta">${h.back ? `戻る ・ ${num(h.km)}km` : `${num(h.km)}km${h.prefectureChanged ? '・県をまたぐ' : ''}${h.near ? '・近くに見えた目的の話へ' : ''}`}${h.shared.length ? ` ・ 共通：${esc(h.shared.join('、'))}` : ''}${h.sharedLandscape.length ? ` ・ どちらも${esc(h.sharedLandscape.join('・'))}` : ''}</span></summary>
<p>${esc(h.to.summary)}</p><a href="${CARD_BASE}${encodeURIComponent(h.to.recordId)}" target="_blank" rel="noopener">怪異・妖怪伝承データベースでこの話を見る</a></details></li>`).join('')}</ol>
<div class="next"><button data-act="next">段階${level.level}の次の問題</button>${nextLevel ? `<button data-act="level" data-level="${nextLevel.level}"${nowOpen ? '' : ' disabled'}>${nowOpen ? `段階${nextLevel.level}へ進む` : `段階${nextLevel.level}はあと${UNLOCK_AFTER - cleared(level)}問`}</button>` : ''}<button data-act="levels">段階を選ぶ</button></div>`;
        drawReview();
    }

    function render(toTop) {
        if (!s) { renderLevels(); drawMap({}); }
        else if (review) renderReview();
        else renderPlay();
        if (toTop && app.getBoundingClientRect().top < 0) app.scrollIntoView({ block: 'start' });
    }

    function act(el) {
        const a = el.dataset.act;
        if (a === 'level') start(D.levels[Number(el.dataset.level) - 1]);
        else if (a === 'move') move(offered[Number(el.dataset.i)]);
        else if (a === 'back') back();
        else if (a === 'giveup') finish(false);
        else if (a === 'levels') { s = null; review = null; render(true); }
        else if (a === 'next') start(s.level, s.puzzle);
        else if (a === 'route') { shownRoute = el.dataset.route; render(false); }
    }
    document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && !el.disabled && el.dataset.locked !== 'true') act(el); });
    map.addEventListener('keydown', e => { const el = e.target.closest('[data-act]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (el.dataset.locked !== 'true') act(el); } });

    // ---------------------------------------------------------------- map
    const K = 40, project = ([lng, lat]) => [(lng - 122.5) * 0.81 * K, (46 - lat) * K];
    const LAND = JP.rings.map(r => 'M' + r.map(p => project(p).map(v => v.toFixed(1)).join(' ')).join('L') + 'Z').join('');
    const WHOLE = [-53, -5, 900];   // x, y, side: all of Japan

    /** opt: trail, other (a route to compare), pins (candidate cards), here, goal, detours. */
    function drawMap(opt) {
        const pts = [...(opt.trail || []), ...(opt.other || []), ...(opt.pins || []).map(p => p.story), ...(opt.here ? [opt.here] : []), ...(opt.goal ? [opt.goal] : [])].map(x => project(x.coordinates))
            .concat((opt.detours || []).map(d => project(d.coordinates)));
        let [x0, y0, side] = WHOLE;
        if (pts.length) {
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
            side = Math.min(900, Math.max(w, h) * 1.35 + 60, 900);
            side = Math.max(side, 240);
            x0 = (Math.max(...xs) + Math.min(...xs)) / 2 - side / 2; y0 = (Math.max(...ys) + Math.min(...ys)) / 2 - side / 2;
        }
        const u = side / 100, f = v => v.toFixed(1);
        const line = (list, cls, extra) => list.length > 1 ? `<polyline class="${cls}" points="${list.map(x => project(x.coordinates).map(f).join(',')).join(' ')}" stroke-width="${f(u * 0.7)}"${extra || ''}/>` : '';
        const text = (x, y, cls, t) => `<text class="label ${cls}" x="${f(x)}" y="${f(y)}" font-size="${f(u * 2.6)}" stroke-width="${f(u * 0.7)}" text-anchor="middle">${esc(t)}</text>`;
        let out = `<path class="land" d="${LAND}" stroke-width="${f(u * 0.15)}"/>`;
        out += line(opt.trail || [], 'trail') + line(opt.other || [], 'other', ` stroke-dasharray="${f(u * 1.6)} ${f(u * 1.2)}"`);
        for (const stop of (opt.trail || []).slice(0, -1)) { const [x, y] = project(stop.coordinates); out += `<circle class="stop" cx="${f(x)}" cy="${f(y)}" r="${f(u * 0.8)}"/>`; }
        for (const d of opt.detours || []) {
            const [x, y] = project(d.coordinates), r = u * 1.5;
            out += `<path class="detour" data-done="${d.done}" stroke-width="${f(u * 0.4)}" d="M${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}L${f(x - r)} ${f(y)}Z"/>` + text(x, y + u * 4.4, 'detourLabel', `寄り道 ${d.name}`);
        }
        if (opt.goal) { const [x, y] = project(opt.goal.coordinates); out += `<circle class="goal" cx="${f(x)}" cy="${f(y)}" r="${f(u * 2.4)}" stroke-width="${f(u * 0.6)}"/>` + text(x, y - u * 3.4, 'goalLabel', '目的'); }
        if (opt.here) { const [x, y] = project(opt.here.coordinates); out += `<circle class="here" cx="${f(x)}" cy="${f(y)}" r="${f(u * 1.5)}" stroke-width="${f(u * 0.4)}"/>` + text(x, y + u * 4.2, '', 'いま'); }
        // Pins at or close to one place (most stories sit on a prefecture's point) fan out around it,
        // each with a line back to its own place.
        const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < u * 5;
        const fixed = [opt.here, opt.goal].filter(Boolean).map(x => project(x.coordinates));
        const groups = [];
        for (const p of opt.pins || []) {
            const at = project(p.story.coordinates), group = groups.find(g => close(g.at, at));
            if (group) group.pins.push({ p, at }); else groups.push({ at, pins: [{ p, at }] });
        }
        for (const group of groups) {
            const count = group.pins.length, fan = count > 1 || fixed.some(q => close(q, group.at)), r = Math.max(u * 6, count * u * 1.6);
            group.pins.forEach(({ p, at: [cx, cy] }, n) => {
                // No pin straight below the place: the "いま" label sits there.
                const a = count > 1 ? -Math.PI / 2 + (count % 2 ? 0 : Math.PI / count) + n * 2 * Math.PI / count : -Math.PI / 4;
                const x = fan ? group.at[0] + r * Math.cos(a) : cx, y = fan ? group.at[1] + r * Math.sin(a) : cy;
                if (fan) out += `<line class="leader" x1="${f(cx)}" y1="${f(cy)}" x2="${f(x)}" y2="${f(y)}" stroke-width="${f(u * 0.2)}"/>`;
                out += `<g class="pin" data-act="move" data-i="${p.i}" data-locked="${p.locked}" tabindex="0" role="button" aria-label="${LETTERS[p.i]} ${esc(p.story.name)} ${esc(p.story.prefecture)}"><title>${LETTERS[p.i]} ${esc(p.story.name)}（${esc(p.story.prefecture)}）</title><circle cx="${f(x)}" cy="${f(y)}" r="${f(u * 2.3)}"/><text x="${f(x)}" y="${f(y)}" font-size="${f(u * 2.7)}">${LETTERS[p.i]}</text></g>`;
            });
        }
        map.setAttribute('viewBox', `${f(x0)} ${f(y0)} ${f(side)} ${f(side)}`);
        map.innerHTML = out;
    }

    function drawPlay(here) {
        const left = detoursLeft();
        drawMap({ trail: s.stack.map(n => stories[n]), here, goal: stories[s.puzzle.target],
            pins: offered.map((o, i) => ({ story: o, i, locked: o.node === s.puzzle.target && left.length > 0 })).filter(p => p.story.node !== s.puzzle.target),
            detours: s.puzzle.detours.map(d => ({ name: d.prefecture, coordinates: d.coordinates, done: s.seen.has(d.prefecture) })) });
    }
    function drawReview() {
        drawMap({ trail: stopsOf(review.mine).length ? stopsOf(review.mine) : [stories[s.puzzle.start]], other: shownRoute === 'mine' ? [] : stopsOf(routeOf(shownRoute)), goal: stories[s.puzzle.target],
            detours: review.detours.map(d => ({ name: d.prefecture, coordinates: d.coordinates, done: d.visited })) });
    }

    document.getElementById('about').textContent = `この版は、全体${num(D.source.stories)}話のうち、${D.levels.reduce((n, l) => n + l.puzzles.length, 0)}問とその道のまわりの${num(N)}話だけを収めた小さな版です。ここでたどれる道はすべて、全体の版でもたどれる道です。`;
    render(false);
})();
