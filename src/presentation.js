(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.KMapPresentation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Zachováme místo pro hodnotu/index i při deseti nutných překryvech.
    const INNER_SPACE = 32;
    const BASE_INSET = 2;
    const MIN_LANE_STEP = 2.5;

    function assertLaneCount(count) {
        if (!Number.isInteger(count) || count < 0) {
            throw new RangeError('Počet kolejí musí být nezáporné celé číslo.');
        }
    }

    function minimumCellSize(laneCount) {
        assertLaneCount(laneCount);
        if (laneCount === 0) return 0;
        return Math.ceil(INNER_SPACE + 2 * (BASE_INSET + (laneCount - 1) * MIN_LANE_STEP));
    }

    function outlineInsets(laneCount, cellSize) {
        assertLaneCount(laneCount);
        if (!Number.isFinite(cellSize) || cellSize <= 0) {
            throw new RangeError('Velikost buňky musí být kladná a konečná.');
        }
        const base = Math.min(BASE_INSET, cellSize * 0.06);
        // Bezpečný limit platí i při vynuceném externím CSS. Aplikace zároveň
        // zvětšuje buňky podle minimumCellSize(), takže se tahy neslévají.
        const maximum = Math.max(base, Math.min(cellSize * 0.35, (cellSize - INNER_SPACE) / 2));
        const step = laneCount > 1 ? Math.min(3, (maximum - base) / (laneCount - 1)) : 0;
        return Array.from({ length: laneCount }, (_, lane) => base + lane * step);
    }

    function literalText(variable, negated) {
        if (!/^[A-E]$/.test(variable)) throw new RangeError('Neplatná proměnná.');
        // Kombinující horní čára je skutečná součást textu, nejen CSS dekorace.
        return negated ? `${variable}\u0305` : variable;
    }

    function termText(model, mode) {
        if (mode !== 'minterm' && mode !== 'maxterm') throw new RangeError('Neplatný režim.');
        if (model.constant !== null) return String(model.constant);
        const parts = model.literals.map(literal => literalText(literal.variable, literal.negated));
        if (mode === 'minterm') {
            if (parts.length === 0) return '[?]';
            return parts.join('·') + (model.complete ? '' : '·?');
        }
        if (!model.complete || parts.length === 0) parts.push('?');
        return `(${parts.join(' + ')})`;
    }

    return Object.freeze({ minimumCellSize, outlineInsets, literalText, termText });
}));
