(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.KMapCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VARIABLE_NAMES = Object.freeze(['A', 'B', 'C', 'D', 'E']);

    function assertVariableCount(variableCount) {
        if (!Number.isInteger(variableCount) || variableCount < 2 || variableCount > 5) {
            throw new RangeError('Počet proměnných musí být celé číslo od 2 do 5.');
        }
    }

    function getVariableNames(variableCount) {
        assertVariableCount(variableCount);
        return VARIABLE_NAMES.slice(0, variableCount);
    }

    function totalCellCount(variableCount) {
        assertVariableCount(variableCount);
        return 2 ** variableCount;
    }

    function normalizeIndices(indices, variableCount) {
        const total = totalCellCount(variableCount);
        const values = Array.from(new Set(indices));
        for (const value of values) {
            if (!Number.isInteger(value) || value < 0 || value >= total) {
                throw new RangeError(`Index ${value} je mimo rozsah 0–${total - 1}.`);
            }
        }
        return values.sort((a, b) => a - b);
    }

    function parseIndices(input, variableCount) {
        assertVariableCount(variableCount);
        const total = 2 ** variableCount;
        const source = String(input ?? '').trim();

        if (source === '' || source === '∅') {
            return { ok: true, values: [], invalidTokens: [] };
        }

        const tokens = source.split(',').map(token => token.trim());
        const invalidTokens = tokens.filter(token => {
            if (!/^\d+$/.test(token)) return true;
            const value = Number(token);
            return !Number.isSafeInteger(value) || value < 0 || value >= total;
        });

        if (invalidTokens.length > 0) {
            return { ok: false, values: [], invalidTokens };
        }

        return {
            ok: true,
            values: Array.from(new Set(tokens.map(Number))).sort((a, b) => a - b),
            invalidTokens: []
        };
    }

    function grayCode(bitCount) {
        if (!Number.isInteger(bitCount) || bitCount < 1 || bitCount > 3) {
            throw new RangeError('Pro mapu je podporován Grayův kód o délce 1 až 3 bity.');
        }

        return Array.from({ length: 2 ** bitCount }, (_, index) => index ^ (index >> 1));
    }

    function toBinary(value, width) {
        return value.toString(2).padStart(width, '0');
    }

    function activeRuns(values, bitPosition) {
        const runs = [];
        let start = null;

        for (let position = 0; position <= values.length; position += 1) {
            const active = position < values.length
                && ((values[position] >> bitPosition) & 1) === 1;

            if (active && start === null) {
                start = position;
            } else if (!active && start !== null) {
                runs.push({ start, span: position - start });
                start = null;
            }
        }

        return runs;
    }

    function createVariableGuides(values, variableNames, bitCount) {
        return variableNames.map((name, variablePosition) => {
            const bitPosition = variablePosition;
            return {
                name,
                bitPosition,
                runs: activeRuns(values, bitPosition)
            };
        });
    }

    function getMapLayout(variableCount) {
        assertVariableCount(variableCount);
        const rowBits = Math.floor(variableCount / 2);
        const columnBits = variableCount - rowBits;
        const rows = grayCode(rowBits);
        const columns = grayCode(columnBits);
        const variableNames = getVariableNames(variableCount);

        // Rozložení odpovídá dodaným výukovým podkladům:
        // A, B a případně C tvoří sloupce (nižší bity indexu),
        // zbývající proměnné tvoří řádky.
        const columnVariableNames = variableNames.slice(0, columnBits);
        const rowVariableNames = variableNames.slice(columnBits);

        return {
            rowBits,
            columnBits,
            rows,
            columns,
            rowVariableNames,
            columnVariableNames,
            rowGuides: createVariableGuides(rows, rowVariableNames, rowBits),
            columnGuides: createVariableGuides(columns, columnVariableNames, columnBits),
            indexAt(rowPosition, columnPosition) {
                return (rows[rowPosition] << columnBits) | columns[columnPosition];
            }
        };
    }

    function popcount(value) {
        let count = 0;
        let remaining = value >>> 0;
        while (remaining !== 0) {
            remaining &= remaining - 1;
            count += 1;
        }
        return count;
    }

    function isPowerOfTwo(value) {
        return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
    }

    function groupSignature(indices, variableCount) {
        const normalized = normalizeIndices(indices, variableCount);
        if (normalized.length === 0) {
            return null;
        }

        let combinedAnd = normalized[0];
        let combinedOr = normalized[0];
        for (const index of normalized) {
            combinedAnd &= index;
            combinedOr |= index;
        }

        const allBitsMask = (1 << variableCount) - 1;
        const changingMask = (combinedAnd ^ combinedOr) & allBitsMask;
        const fixedMask = allBitsMask ^ changingMask;
        const fixedValue = normalized[0] & fixedMask;

        return {
            indices: normalized,
            changingMask,
            fixedMask,
            fixedValue,
            literalCount: popcount(fixedMask)
        };
    }

    function indicesForCube(fixedMask, fixedValue, variableCount) {
        const result = [];
        const total = totalCellCount(variableCount);
        for (let index = 0; index < total; index += 1) {
            if ((index & fixedMask) === fixedValue) result.push(index);
        }
        return result;
    }

    function bitForIndex(index) {
        return (1 << index) >>> 0;
    }

    function maskAnd(left, right) {
        return (left & right) >>> 0;
    }

    function maskOr(left, right) {
        return (left | right) >>> 0;
    }

    function maskWithout(left, right) {
        return (left & ~right) >>> 0;
    }

    function maskContains(container, subset) {
        return maskAnd(container, subset) === (subset >>> 0);
    }

    function maskHasIndex(mask, index) {
        return maskAnd(mask, bitForIndex(index)) !== 0;
    }

    function indicesToMask(indices) {
        let mask = 0;
        for (const index of indices) mask = maskOr(mask, bitForIndex(index));
        return mask >>> 0;
    }

    function isValidGroup(indices, variableCount) {
        let signature;
        try {
            signature = groupSignature(indices, variableCount);
        } catch {
            return false;
        }

        if (!signature || !isPowerOfTwo(signature.indices.length)) return false;
        if (popcount(signature.changingMask) !== Math.log2(signature.indices.length)) return false;

        const expected = indicesForCube(signature.fixedMask, signature.fixedValue, variableCount);
        return expected.length === signature.indices.length
            && expected.every((value, position) => value === signature.indices[position]);
    }

    function getGroupLogic(indices, variableCount) {
        const signature = groupSignature(indices, variableCount);
        if (!signature || !isValidGroup(signature.indices, variableCount)) {
            return { involvedVars: [], values: {}, literalCount: 0, valid: false };
        }

        const names = getVariableNames(variableCount);
        const involvedVars = [];
        const values = {};

        for (let variablePosition = 0; variablePosition < variableCount; variablePosition += 1) {
            const bitPosition = variablePosition;
            const bit = 1 << bitPosition;
            if ((signature.fixedMask & bit) !== 0) {
                const name = names[variablePosition];
                involvedVars.push(name);
                values[name] = (signature.fixedValue & bit) !== 0 ? 1 : 0;
            }
        }

        return {
            involvedVars,
            values,
            literalCount: involvedVars.length,
            valid: true,
            fixedMask: signature.fixedMask,
            fixedValue: signature.fixedValue
        };
    }

    function enumerateValidImplicants(targetIndices, variableCount) {
        const targets = normalizeIndices(targetIndices, variableCount);
        if (targets.length === 0) return [];

        const targetMask = indicesToMask(targets);
        const allBitsMask = (1 << variableCount) - 1;
        const candidates = [];
        const ternaryCount = 3 ** variableCount;

        // Stav číslice: 0 = proměnná se mění, 1 = pevná 0, 2 = pevná 1.
        for (let code = 0; code < ternaryCount; code += 1) {
            let rest = code;
            let fixedMask = 0;
            let fixedValue = 0;

            for (let variablePosition = 0; variablePosition < variableCount; variablePosition += 1) {
                const state = rest % 3;
                rest = Math.floor(rest / 3);
                const bitPosition = variablePosition;
                const bit = 1 << bitPosition;

                if (state !== 0) fixedMask |= bit;
                if (state === 2) fixedValue |= bit;
            }

            fixedMask &= allBitsMask;
            fixedValue &= fixedMask;
            const indices = indicesForCube(fixedMask, fixedValue, variableCount);
            const coverMask = indicesToMask(indices);

            if (!maskContains(targetMask, coverMask)) continue;

            candidates.push({
                indices,
                coverMask,
                fixedMask,
                fixedValue,
                literalCount: popcount(fixedMask),
                cellCount: indices.length,
                key: `${fixedMask}:${fixedValue}`
            });
        }

        return candidates;
    }

    function findPrimeImplicants(targetIndices, variableCount) {
        const candidates = enumerateValidImplicants(targetIndices, variableCount);
        const primes = candidates.filter(candidate => !candidates.some(other => (
            other.coverMask !== candidate.coverMask
            && other.cellCount > candidate.cellCount
            && maskContains(other.coverMask, candidate.coverMask)
        )));

        return primes.sort((a, b) => (
            b.cellCount - a.cellCount
            || a.literalCount - b.literalCount
            || a.fixedMask - b.fixedMask
            || a.fixedValue - b.fixedValue
        ));
    }

    function compareCost(left, right) {
        if (left.terms !== right.terms) return left.terms - right.terms;
        return left.literals - right.literals;
    }

    function findMinimalCover(targetIndices, variableCount) {
        const targets = normalizeIndices(targetIndices, variableCount);
        if (targets.length === 0) {
            return {
                targets,
                primeImplicants: [],
                cover: [],
                cost: { terms: 0, literals: 0 },
                isConstantWithoutGroups: true
            };
        }

        const targetMask = indicesToMask(targets);
        const primes = findPrimeImplicants(targets, variableCount);
        const coveringByTarget = new Map();

        for (const target of targets) {
            const covering = [];
            for (let primeIndex = 0; primeIndex < primes.length; primeIndex += 1) {
                if (maskHasIndex(primes[primeIndex].coverMask, target)) covering.push(primeIndex);
            }
            coveringByTarget.set(target, covering);
        }

        const essentialSet = new Set();
        for (const target of targets) {
            const covering = coveringByTarget.get(target);
            if (covering.length === 1) essentialSet.add(covering[0]);
        }

        const initialSelected = Array.from(essentialSet).sort((a, b) => a - b);
        let initialCovered = 0;
        let initialLiterals = 0;
        for (const primeIndex of initialSelected) {
            initialCovered = maskOr(initialCovered, primes[primeIndex].coverMask);
            initialLiterals += primes[primeIndex].literalCount;
        }
        initialCovered = maskAnd(initialCovered, targetMask);

        let bestCost = { terms: Number.POSITIVE_INFINITY, literals: Number.POSITIVE_INFINITY };
        let bestSelected = [];
        const seen = new Map();

        function selectedCost(selected, literals) {
            return { terms: selected.length, literals };
        }

        function chooseUncoveredTarget(coveredMask, selectedSet) {
            let bestTarget = null;
            let bestOptions = null;

            for (const target of targets) {
                if (maskHasIndex(coveredMask, target)) continue;
                const options = coveringByTarget.get(target).filter(primeIndex => {
                    if (selectedSet.has(primeIndex)) return false;
                    return maskAnd(maskOr(coveredMask, primes[primeIndex].coverMask), targetMask) !== coveredMask;
                });

                if (bestOptions === null || options.length < bestOptions.length) {
                    bestTarget = target;
                    bestOptions = options;
                }
            }

            return { target: bestTarget, options: bestOptions ?? [] };
        }

        function lowerBoundAdditionalTerms(coveredMask, selectedSet) {
            const uncoveredMask = maskWithout(targetMask, coveredMask);
            const uncoveredCount = popcount(uncoveredMask);
            if (uncoveredCount === 0) return 0;

            let maxGain = 0;
            for (let primeIndex = 0; primeIndex < primes.length; primeIndex += 1) {
                if (selectedSet.has(primeIndex)) continue;
                const gain = popcount(maskAnd(primes[primeIndex].coverMask, uncoveredMask));
                if (gain > maxGain) maxGain = gain;
            }
            return maxGain === 0 ? Number.POSITIVE_INFINITY : Math.ceil(uncoveredCount / maxGain);
        }

        function search(coveredMask, selected, selectedSet, literals) {
            const cost = selectedCost(selected, literals);

            if (coveredMask === targetMask) {
                if (compareCost(cost, bestCost) < 0) {
                    bestCost = cost;
                    bestSelected = selected.slice();
                }
                return;
            }

            if (cost.terms >= bestCost.terms) return;

            const lowerBound = lowerBoundAdditionalTerms(coveredMask, selectedSet);
            if (cost.terms + lowerBound > bestCost.terms) return;

            const seenCost = seen.get(coveredMask);
            if (seenCost && compareCost(cost, seenCost) >= 0) return;
            seen.set(coveredMask, cost);

            const choice = chooseUncoveredTarget(coveredMask, selectedSet);
            if (choice.target === null || choice.options.length === 0) return;

            const uncoveredMask = maskWithout(targetMask, coveredMask);
            choice.options.sort((leftIndex, rightIndex) => {
                const left = primes[leftIndex];
                const right = primes[rightIndex];
                const leftGain = popcount(maskAnd(left.coverMask, uncoveredMask));
                const rightGain = popcount(maskAnd(right.coverMask, uncoveredMask));
                return rightGain - leftGain
                    || left.literalCount - right.literalCount
                    || leftIndex - rightIndex;
            });

            for (const primeIndex of choice.options) {
                const prime = primes[primeIndex];
                const nextCovered = maskAnd(maskOr(coveredMask, prime.coverMask), targetMask);
                if (nextCovered === coveredMask) continue;

                selected.push(primeIndex);
                selectedSet.add(primeIndex);
                search(nextCovered, selected, selectedSet, literals + prime.literalCount);
                selectedSet.delete(primeIndex);
                selected.pop();
            }
        }

        const initialSet = new Set(initialSelected);
        search(initialCovered, initialSelected.slice(), initialSet, initialLiterals);

        if (!Number.isFinite(bestCost.terms)) {
            throw new Error('Pro zadanou funkci se nepodařilo najít úplné pokrytí.');
        }

        const cover = bestSelected
            .map(primeIndex => primes[primeIndex])
            .sort((a, b) => b.cellCount - a.cellCount || a.literalCount - b.literalCount || a.key.localeCompare(b.key));

        return {
            targets,
            primeImplicants: primes,
            cover,
            cost: bestCost,
            isConstantWithoutGroups: false
        };
    }

    function isGroupMaximal(indices, targetIndices, variableCount) {
        if (!isValidGroup(indices, variableCount)) return false;
        const normalized = normalizeIndices(indices, variableCount);
        const targetSet = new Set(normalizeIndices(targetIndices, variableCount));
        if (!normalized.every(index => targetSet.has(index))) return false;

        const signature = groupSignature(normalized, variableCount);
        for (let bitPosition = 0; bitPosition < variableCount; bitPosition += 1) {
            const bit = 1 << bitPosition;
            if ((signature.fixedMask & bit) === 0) continue;

            const expandedFixedMask = signature.fixedMask & ~bit;
            const expandedFixedValue = signature.fixedValue & expandedFixedMask;
            const expanded = indicesForCube(expandedFixedMask, expandedFixedValue, variableCount);
            if (expanded.every(index => targetSet.has(index))) return false;
        }
        return true;
    }

    function getExpectedLiteralStates(indices, variableCount, solveMode) {
        if (solveMode !== 'minterm' && solveMode !== 'maxterm') {
            throw new RangeError('Režim musí být „minterm“ nebo „maxterm“.');
        }

        const logic = getGroupLogic(indices, variableCount);
        const result = {};
        for (const variable of logic.involvedVars) {
            const bit = logic.values[variable];
            if (solveMode === 'minterm') {
                result[variable] = bit === 1 ? 'positive' : 'negated';
            } else {
                result[variable] = bit === 0 ? 'positive' : 'negated';
            }
        }
        return result;
    }

    function getCoverCost(groups, variableCount) {
        return {
            terms: groups.length,
            literals: groups.reduce((sum, group) => (
                sum + getGroupLogic(group.indices ?? group, variableCount).literalCount
            ), 0)
        };
    }

    function coverTargets(groups, targetIndices, variableCount) {
        const targets = normalizeIndices(targetIndices, variableCount);
        const targetSet = new Set(targets);
        const covered = new Set();
        const outside = new Set();

        for (const group of groups) {
            const indices = normalizeIndices(group.indices ?? group, variableCount);
            for (const index of indices) {
                if (targetSet.has(index)) covered.add(index);
                else outside.add(index);
            }
        }

        return {
            missing: targets.filter(index => !covered.has(index)),
            outside: Array.from(outside).sort((a, b) => a - b),
            covered: Array.from(covered).sort((a, b) => a - b)
        };
    }

    return Object.freeze({
        getVariableNames,
        totalCellCount,
        normalizeIndices,
        parseIndices,
        grayCode,
        toBinary,
        getMapLayout,
        popcount,
        isPowerOfTwo,
        indicesToMask,
        indicesForCube,
        isValidGroup,
        getGroupLogic,
        enumerateValidImplicants,
        findPrimeImplicants,
        findMinimalCover,
        isGroupMaximal,
        getExpectedLiteralStates,
        getCoverCost,
        coverTargets,
        compareCost
    });
}));
