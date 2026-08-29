(function () {
    'use strict';

    const core = window.KMapCore;
    if (!core) throw new Error('Logické jádro KMapCore nebylo načteno.');

    const Phase = Object.freeze({
        TABLE: 'table',
        MAP: 'map',
        SOLVER: 'solver',
        COMPLETE: 'complete'
    });

    const LiteralState = Object.freeze({
        OMITTED: 'omitted',
        POSITIVE: 'positive',
        NEGATED: 'negated'
    });

    const VALUE_STATES = Object.freeze([null, 0, 1]);
    const GROUP_COLORS = Object.freeze([
        '#ff7043', '#ffb300', '#9ccc65', '#ec407a',
        '#ab47bc', '#ef5350', '#ffa726', '#d4e157'
    ]);
    const GROUP_BORDER_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'double']);

    const state = {
        variableCount: 4,
        solveMode: 'minterm',
        difficulty: 'medium',
        taskIndices: [],
        taskSet: new Set(),
        optimalSolution: null,
        tableValues: [],
        mapValues: [],
        tableErrors: new Set(),
        mapErrors: new Set(),
        phase: Phase.TABLE,
        selectedIndices: new Set(),
        groups: [],
        nextGroupId: 1,
        animation: null,
        hintTimer: null
    };

    const elements = {};

    function init() {
        cacheElements();
        bindEvents();
        syncSettingsFromControls();
        generateNewTask();
    }

    function cacheElements() {
        const ids = [
            'varCountSelect', 'solveModeSelect', 'difficultySelect', 'customIndices',
            'applyCustomButton', 'newTaskButton', 'inputStatus', 'taskIndices', 'taskMeaning',
            'truthTable', 'checkTableButton', 'skipTableButton', 'tableMessage',
            'tablePanel', 'tableStepState', 'mapPanel', 'mapStepState', 'mapContainer',
            'animationPanel', 'animationText', 'animationNextButton', 'animationStopButton',
            'checkMapButton', 'mapMessage', 'solverPanel', 'solverStepState',
            'solverInstruction', 'createGroupButton', 'clearSelectionButton', 'hintButton',
            'hintMessage', 'groupMessage', 'groupsList', 'finalEquation',
            'checkFinalButton', 'finalMessage'
        ];

        for (const id of ids) {
            const element = document.getElementById(id);
            if (!element) throw new Error(`V dokumentu chybí prvek #${id}.`);
            elements[id] = element;
        }
    }

    function bindEvents() {
        elements.varCountSelect.addEventListener('change', () => {
            syncSettingsFromControls();
            generateNewTask();
        });
        elements.solveModeSelect.addEventListener('change', () => {
            syncSettingsFromControls();
            generateNewTask();
        });
        elements.difficultySelect.addEventListener('change', () => {
            syncSettingsFromControls();
            generateNewTask();
        });
        elements.newTaskButton.addEventListener('click', generateNewTask);
        elements.applyCustomButton.addEventListener('click', applyCustomTask);
        elements.customIndices.addEventListener('keydown', event => {
            if (event.key === 'Enter') applyCustomTask();
        });

        elements.checkTableButton.addEventListener('click', checkTruthTable);
        elements.skipTableButton.addEventListener('click', fillTruthTableAutomatically);
        elements.checkMapButton.addEventListener('click', checkMap);
        elements.animationNextButton.addEventListener('click', nextAnimationStep);
        elements.animationStopButton.addEventListener('click', () => stopAnimation(true));

        elements.createGroupButton.addEventListener('click', createGroupFromSelection);
        elements.clearSelectionButton.addEventListener('click', clearSelection);
        elements.hintButton.addEventListener('click', showSmartHint);
        elements.checkFinalButton.addEventListener('click', checkFinalResult);
    }

    function syncSettingsFromControls() {
        state.variableCount = Number(elements.varCountSelect.value);
        state.solveMode = elements.solveModeSelect.value;
        state.difficulty = elements.difficultySelect.value;
    }

    function generateNewTask() {
        syncSettingsFromControls();
        clearInputStatus();
        const indices = chooseRandomTask(state.variableCount, state.difficulty);
        setTask(indices);
    }

    function chooseRandomTask(variableCount, difficulty) {
        const total = core.totalCellCount(variableCount);
        const targetScores = {
            easy: 2.2 * variableCount + 2,
            medium: 4.5 * variableCount + 4,
            hard: 7.2 * variableCount + 6
        };
        const targetScore = targetScores[difficulty] ?? targetScores.medium;
        let best = null;

        const maximumAttempts = variableCount === 5 ? 120 : 320;

        for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
            const probability = 0.22 + Math.random() * 0.56;
            const candidate = [];
            for (let index = 0; index < total; index += 1) {
                if (Math.random() < probability) candidate.push(index);
            }
            if (candidate.length === 0 || candidate.length === total) continue;

            const solution = core.findMinimalCover(candidate, variableCount);
            const alternativePressure = Math.max(0, solution.primeImplicants.length - solution.cover.length);
            const singletonPenalty = solution.cover.every(group => group.cellCount === 1) ? 4 : 0;
            const complexity = (
                solution.cost.terms * 4
                + solution.cost.literals
                + alternativePressure * 1.7
                + (difficulty === 'easy' ? singletonPenalty : 0)
            );
            const distance = Math.abs(complexity - targetScore);

            if (!best || distance < best.distance) {
                best = { indices: candidate, distance };
            }
            if (distance < 0.45) break;
        }

        if (best) return best.indices.sort((a, b) => a - b);

        // Bezpečný fallback pro krajní kombinace nastavení.
        return Array.from({ length: total }, (_, index) => index)
            .filter(index => index % 3 === 1);
    }

    function applyCustomTask() {
        syncSettingsFromControls();
        const result = core.parseIndices(elements.customIndices.value, state.variableCount);
        if (!result.ok) {
            const invalid = result.invalidTokens.map(token => `„${token || 'prázdná hodnota'}“`).join(', ');
            elements.customIndices.setAttribute('aria-invalid', 'true');
            elements.inputStatus.textContent = `Neplatné položky: ${invalid}. Povolená jsou pouze celá čísla 0–${core.totalCellCount(state.variableCount) - 1}.`;
            elements.customIndices.focus();
            return;
        }

        clearInputStatus();
        setTask(result.values);
    }

    function clearInputStatus() {
        elements.customIndices.removeAttribute('aria-invalid');
        elements.inputStatus.textContent = '';
    }

    function setTask(indices) {
        state.taskIndices = core.normalizeIndices(indices, state.variableCount);
        state.taskSet = new Set(state.taskIndices);
        state.optimalSolution = core.findMinimalCover(state.taskIndices, state.variableCount);
        resetExerciseState();
        updateTaskDescription();
    }

    function resetExerciseState() {
        stopAnimation(false);
        if (state.hintTimer !== null) {
            window.clearTimeout(state.hintTimer);
            state.hintTimer = null;
        }

        const total = core.totalCellCount(state.variableCount);
        state.tableValues = new Array(total).fill(null);
        state.mapValues = new Array(total).fill(null);
        state.tableErrors = new Set();
        state.mapErrors = new Set();
        state.phase = Phase.TABLE;
        state.selectedIndices = new Set();
        state.groups = [];
        state.nextGroupId = 1;

        hideAllMessages();
        renderTruthTable();
        renderMap();
        renderGroups();
        updateEquation();
        updatePhaseUi();
    }

    function updateTaskDescription() {
        const indices = state.taskIndices.length > 0 ? state.taskIndices.join(', ') : '∅';
        const notation = state.solveMode === 'minterm' ? 'Σm' : 'ΠM';
        const targetName = state.solveMode === 'minterm' ? 'jedničku' : 'nulu';
        elements.taskIndices.textContent = `Y = ${notation}(${indices})`;
        elements.taskMeaning.textContent = `Na uvedených indexech musí být ${targetName}.`;
    }

    function expectedValue(index) {
        const targetValue = state.solveMode === 'minterm' ? 1 : 0;
        return state.taskSet.has(index) ? targetValue : 1 - targetValue;
    }

    function cycleValue(value) {
        const currentPosition = VALUE_STATES.indexOf(value);
        return VALUE_STATES[(currentPosition + 1) % VALUE_STATES.length];
    }

    function valueLabel(value) {
        return value === null ? '?' : String(value);
    }

    function valueClass(value) {
        if (value === null) return 'value-empty';
        return value === 1 ? 'value-one' : 'value-zero';
    }

    function setPanelLocked(panel, locked) {
        panel.classList.toggle('is-locked', locked);
        panel.setAttribute('aria-disabled', String(locked));
        panel.inert = locked;
    }

    function setStepState(element, text, complete) {
        element.textContent = text;
        element.classList.toggle('is-complete', complete);
    }

    function updatePhaseUi() {
        const tableComplete = state.phase !== Phase.TABLE;
        const mapUnlocked = state.phase !== Phase.TABLE;
        const mapComplete = state.phase === Phase.SOLVER || state.phase === Phase.COMPLETE;
        const solverUnlocked = mapComplete;
        const exerciseComplete = state.phase === Phase.COMPLETE;

        setPanelLocked(elements.mapPanel, !mapUnlocked);
        setPanelLocked(elements.solverPanel, !solverUnlocked);

        setStepState(elements.tableStepState, tableComplete ? 'Hotovo' : 'Aktivní', tableComplete);
        setStepState(
            elements.mapStepState,
            !mapUnlocked ? 'Uzamčeno' : mapComplete ? 'Hotovo' : 'Aktivní',
            mapComplete
        );
        setStepState(
            elements.solverStepState,
            !solverUnlocked ? 'Uzamčeno' : exerciseComplete ? 'Splněno' : 'Aktivní',
            exerciseComplete
        );

        elements.checkTableButton.disabled = state.phase !== Phase.TABLE;
        elements.skipTableButton.disabled = state.phase !== Phase.TABLE;
        elements.checkMapButton.disabled = state.phase !== Phase.MAP;

        const solverDisabled = !solverUnlocked;
        elements.createGroupButton.disabled = solverDisabled;
        elements.clearSelectionButton.disabled = solverDisabled || state.selectedIndices.size === 0;
        elements.hintButton.disabled = solverDisabled;
        elements.checkFinalButton.disabled = solverDisabled;

        renderTruthTable();
        renderMap();
    }

    function renderTruthTable() {
        const table = elements.truthTable;
        table.replaceChildren();

        const caption = document.createElement('caption');
        caption.className = 'sr-only';
        caption.textContent = 'Pravdivostní tabulka zadané logické funkce';
        table.appendChild(caption);

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const hintHeader = document.createElement('th');
        hintHeader.scope = 'col';
        hintHeader.textContent = 'Mapa';
        headerRow.appendChild(hintHeader);

        for (const variable of core.getVariableNames(state.variableCount)) {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = variable;
            headerRow.appendChild(th);
        }

        const outputHeader = document.createElement('th');
        outputHeader.scope = 'col';
        outputHeader.textContent = 'Y';
        headerRow.appendChild(outputHeader);
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const canAnimate = state.phase !== Phase.TABLE;
        const canEdit = state.phase === Phase.TABLE;

        for (let index = 0; index < state.tableValues.length; index += 1) {
            const row = document.createElement('tr');
            row.dataset.index = String(index);
            if (state.tableErrors.has(index)) row.classList.add('row-error');

            const eyeCell = document.createElement('td');
            const eyeButton = document.createElement('button');
            eyeButton.type = 'button';
            eyeButton.className = 'eye-button';
            eyeButton.textContent = '👁';
            eyeButton.title = `Ukázat cestu indexu ${index} do mapy`;
            eyeButton.setAttribute('aria-label', `Ukázat cestu indexu ${index} do Karnaughovy mapy`);
            eyeButton.disabled = !canAnimate;
            eyeButton.addEventListener('click', () => startAnimation(index));
            eyeCell.appendChild(eyeButton);
            row.appendChild(eyeCell);

            for (let bitPosition = 0; bitPosition < state.variableCount; bitPosition += 1) {
                const cell = document.createElement('td');
                cell.textContent = String((index >> bitPosition) & 1);
                row.appendChild(cell);
            }

            const outputCell = document.createElement('td');
            const outputButton = document.createElement('button');
            const value = state.tableValues[index];
            outputButton.type = 'button';
            outputButton.className = `output-button ${valueClass(value)}`;
            outputButton.textContent = valueLabel(value);
            outputButton.disabled = !canEdit;
            outputButton.setAttribute('aria-label', `Index ${index}, Y je ${value === null ? 'nevyplněno' : value}. Změnit hodnotu.`);
            outputButton.addEventListener('click', () => {
                state.tableValues[index] = cycleValue(state.tableValues[index]);
                state.tableErrors.delete(index);
                hideMessage(elements.tableMessage);
                renderTruthTable();
            });
            outputCell.appendChild(outputButton);
            row.appendChild(outputCell);
            tbody.appendChild(row);
        }

        table.appendChild(tbody);
    }

    function checkTruthTable() {
        state.tableErrors = new Set();
        const incomplete = [];
        const incorrect = [];

        for (let index = 0; index < state.tableValues.length; index += 1) {
            const value = state.tableValues[index];
            if (value === null) {
                incomplete.push(index);
                state.tableErrors.add(index);
            } else if (value !== expectedValue(index)) {
                incorrect.push(index);
                state.tableErrors.add(index);
            }
        }

        renderTruthTable();

        if (incomplete.length > 0) {
            showMessage(elements.tableMessage, 'error', `Nejprve doplň všechny hodnoty. Nevyplněné řádky: ${formatIndices(incomplete)}.`);
            return;
        }
        if (incorrect.length > 0) {
            showMessage(elements.tableMessage, 'error', `Nesprávné hodnoty jsou na indexech ${formatIndices(incorrect)}.`);
            return;
        }

        state.tableErrors.clear();
        state.phase = Phase.MAP;
        updatePhaseUi();
        showMessage(elements.tableMessage, 'success', 'Tabulka je správně. Nyní přenes hodnoty do mapy podle Grayova pořadí.');
    }

    function fillTruthTableAutomatically() {
        state.tableValues = state.tableValues.map((_, index) => expectedValue(index));
        state.tableErrors.clear();
        state.phase = Phase.MAP;
        updatePhaseUi();
        showMessage(elements.tableMessage, 'success', 'Tabulka byla vyplněna automaticky. Pokračuj přepisem do mapy.');
    }

    function renderMap() {
        const layout = core.getMapLayout(state.variableCount);
        const diagram = document.createElement('div');
        diagram.className = 'kmap-diagram';
        diagram.style.setProperty('--map-column-count', String(layout.columns.length));
        diagram.style.setProperty('--map-row-count', String(layout.rows.length));
        diagram.style.setProperty('--column-guide-count', String(layout.columnGuides.length));
        diagram.style.setProperty('--row-guide-count', String(layout.rowGuides.length));

        const columnGuides = createVariableGuideLayer(layout.columnGuides, 'column');
        const rowGuides = createVariableGuideLayer(layout.rowGuides, 'row');

        const table = document.createElement('table');
        table.className = 'kmap-table';
        table.setAttribute(
            'aria-label',
            `Karnaughova mapa v Grayově pořadí. Řádky: ${layout.rowVariableNames.join(', ')}. Sloupce: ${layout.columnVariableNames.join(', ')}.`
        );

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const axis = document.createElement('th');
        axis.className = 'kmap-axis';
        axis.scope = 'col';
        axis.textContent = 'Gray';
        headerRow.appendChild(axis);

        for (const columnGray of layout.columns) {
            const th = document.createElement('th');
            th.className = 'kmap-column-code';
            th.scope = 'col';
            th.textContent = core.toBinary(columnGray, layout.columnBits);
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const solverMode = state.phase === Phase.SOLVER || state.phase === Phase.COMPLETE;

        for (let rowPosition = 0; rowPosition < layout.rows.length; rowPosition += 1) {
            const row = document.createElement('tr');
            const rowHeader = document.createElement('th');
            rowHeader.className = 'kmap-row-code';
            rowHeader.scope = 'row';
            rowHeader.textContent = core.toBinary(layout.rows[rowPosition], layout.rowBits);
            row.appendChild(rowHeader);

            for (let columnPosition = 0; columnPosition < layout.columns.length; columnPosition += 1) {
                const index = layout.indexAt(rowPosition, columnPosition);
                const cellWrapper = document.createElement('td');
                cellWrapper.className = 'kmap-cell-wrapper';

                const button = document.createElement('button');
                const value = state.mapValues[index];
                const isTarget = state.taskSet.has(index);
                const selected = state.selectedIndices.has(index);
                button.type = 'button';
                button.className = `map-cell ${valueClass(value)}`;
                button.dataset.index = String(index);
                if (selected) button.classList.add('selected');
                if (state.mapErrors.has(index)) button.classList.add('map-error');

                const valueSpan = document.createElement('span');
                valueSpan.className = 'map-value';
                valueSpan.textContent = valueLabel(value);
                button.appendChild(valueSpan);

                const indexSpan = document.createElement('span');
                indexSpan.className = 'map-index';
                indexSpan.textContent = String(index);
                button.appendChild(indexSpan);

                const participating = state.groups
                    .map((group, groupPosition) => ({ group, groupPosition }))
                    .filter(entry => entry.group.indices.includes(index));

                if (participating.length > 0) {
                    const badges = document.createElement('span');
                    badges.className = 'group-badges';
                    participating.forEach(({ group, groupPosition }, markerPosition) => {
                        const border = document.createElement('span');
                        border.className = 'group-border';
                        border.style.inset = `${2 + markerPosition * 3}px`;
                        border.style.borderColor = group.color;
                        border.style.borderStyle = group.borderStyle;
                        button.appendChild(border);

                        const badge = document.createElement('span');
                        badge.className = 'group-badge';
                        badge.style.backgroundColor = group.color;
                        badge.textContent = String(groupPosition + 1);
                        badges.appendChild(badge);
                    });
                    button.appendChild(badges);
                }

                if (state.phase === Phase.MAP) {
                    button.disabled = Boolean(state.animation);
                    button.setAttribute('aria-label', `Index ${index}, hodnota ${value === null ? 'nevyplněno' : value}. Změnit hodnotu mapy.`);
                } else if (solverMode) {
                    button.disabled = !isTarget || Boolean(state.animation);
                    button.setAttribute('aria-pressed', String(selected));
                    button.setAttribute(
                        'aria-label',
                        isTarget
                            ? `Index ${index}, cílová hodnota ${value}. ${selected ? 'Odebrat z výběru' : 'Přidat do výběru skupiny'}.`
                            : `Index ${index}, hodnota ${value}, nelze zahrnout do skupiny.`
                    );
                } else {
                    button.disabled = true;
                    button.setAttribute('aria-label', `Index ${index}, mapa je uzamčena.`);
                }

                button.addEventListener('click', () => handleMapClick(index));
                cellWrapper.appendChild(button);
                row.appendChild(cellWrapper);
            }
            tbody.appendChild(row);
        }

        table.appendChild(tbody);
        diagram.append(columnGuides, rowGuides, table);
        elements.mapPanel.classList.toggle('has-five-variable-map', state.variableCount === 5);
        elements.mapContainer.classList.toggle('map-container-five', state.variableCount === 5);
        elements.mapContainer.replaceChildren(diagram);
    }

    function createVariableGuideLayer(guides, orientation) {
        const layer = document.createElement('div');
        layer.className = orientation === 'column'
            ? 'variable-guides variable-guides-column'
            : 'variable-guides variable-guides-row';
        layer.setAttribute('aria-hidden', 'true');

        guides.forEach((guide, guidePosition) => {
            guide.runs.forEach((run, runPosition) => {
                const segment = document.createElement('span');
                segment.className = orientation === 'column'
                    ? 'variable-guide variable-guide-column'
                    : 'variable-guide variable-guide-row';
                segment.dataset.variable = guide.name;
                segment.dataset.start = String(run.start);
                segment.dataset.span = String(run.span);
                segment.dataset.segment = String(runPosition);
                segment.style.setProperty('--guide-level', String(guidePosition));
                segment.style.setProperty('--guide-start', String(run.start));
                segment.style.setProperty('--guide-span', String(run.span));
                segment.style.setProperty('--guide-grid-start', String(run.start + 2));
                segment.style.setProperty(
                    '--guide-grid-level',
                    String(guides.length - guidePosition)
                );

                const label = document.createElement('span');
                label.className = 'variable-guide-label';
                label.textContent = guide.name;
                segment.appendChild(label);
                layer.appendChild(segment);
            });
        });

        return layer;
    }

    function handleMapClick(index) {
        if (state.animation) return;

        if (state.phase === Phase.MAP) {
            state.mapValues[index] = cycleValue(state.mapValues[index]);
            state.mapErrors.delete(index);
            hideMessage(elements.mapMessage);
            renderMap();
            return;
        }

        if (state.phase === Phase.SOLVER || state.phase === Phase.COMPLETE) {
            if (!state.taskSet.has(index)) return;
            markSolverDirty();
            if (state.selectedIndices.has(index)) state.selectedIndices.delete(index);
            else state.selectedIndices.add(index);
            elements.clearSelectionButton.disabled = state.selectedIndices.size === 0;
            renderMap();
        }
    }

    function checkMap() {
        state.mapErrors = new Set();
        const incomplete = [];
        const incorrect = [];

        for (let index = 0; index < state.mapValues.length; index += 1) {
            const value = state.mapValues[index];
            if (value === null) {
                incomplete.push(index);
                state.mapErrors.add(index);
            } else if (value !== state.tableValues[index]) {
                incorrect.push(index);
                state.mapErrors.add(index);
            }
        }

        renderMap();

        if (incomplete.length > 0) {
            showMessage(elements.mapMessage, 'error', `Mapa ještě není kompletní. Nevyplněné indexy: ${formatIndices(incomplete)}.`);
            return;
        }
        if (incorrect.length > 0) {
            showMessage(elements.mapMessage, 'error', `Mapa se liší od tabulky na indexech ${formatIndices(incorrect)}.`);
            return;
        }

        state.mapErrors.clear();
        state.phase = Phase.SOLVER;
        const targetWord = state.solveMode === 'minterm' ? 'jedničky' : 'nuly';
        const groupSizes = Array.from(
            { length: state.variableCount + 1 },
            (_, power) => 2 ** power
        ).join(', ');
        elements.solverInstruction.textContent = `Označ sousední ${targetWord} ve skupinách velikosti ${groupSizes}. Poté u každé skupiny urči konstantní proměnné.`;
        updateEquation();
        updatePhaseUi();
        showMessage(elements.mapMessage, 'success', 'Mapa je správně. Minimalizace byla odemčena.');
    }

    function startAnimation(rowIndex) {
        if (state.phase === Phase.TABLE) return;
        stopAnimation(false);
        renderMap();

        const row = elements.truthTable.querySelector(`tbody tr[data-index="${rowIndex}"]`);
        if (row) row.classList.add('active-row');

        elements.animationPanel.hidden = false;
        elements.animationNextButton.textContent = 'Začít eliminaci';
        const assignment = core.getVariableNames(state.variableCount)
            .map((variable, bitPosition) => `${variable}=${(rowIndex >> bitPosition) & 1}`)
            .join(', ');
        elements.animationText.textContent = `Hledáme index ${rowIndex}: ${assignment}.`;

        const candidates = new Set();
        for (let index = 0; index < core.totalCellCount(state.variableCount); index += 1) candidates.add(index);

        state.animation = {
            rowIndex,
            step: 0,
            phase: 'show',
            candidates
        };

        for (const cell of getMapCells()) cell.classList.add('dimmed');
    }

    function nextAnimationStep() {
        if (!state.animation) return;
        if (state.animation.phase === 'done') {
            stopAnimation(true);
            return;
        }

        const animation = state.animation;
        const variables = core.getVariableNames(state.variableCount);
        const cells = getMapCells();

        if (animation.step >= state.variableCount) {
            const target = elements.mapContainer.querySelector(`.map-cell[data-index="${animation.rowIndex}"]`);
            if (target) {
                target.classList.remove('dimmed', 'zone-valid', 'zone-invalid');
                target.classList.add('target-pulse');
            }
            elements.animationText.textContent = 'Cíl nalezen. Do této buňky patří hodnota ze stejného řádku pravdivostní tabulky.';
            elements.animationNextButton.textContent = 'Hotovo';
            animation.phase = 'done';
            return;
        }

        const variable = variables[animation.step];
        const bitPosition = animation.step;
        const requiredBit = (animation.rowIndex >> bitPosition) & 1;

        if (animation.phase === 'show') {
            elements.animationText.textContent = `Podmínka ${variable} = ${requiredBit}: zelené buňky vyhovují, červené budou vyloučeny.`;
            for (const cell of cells) {
                const index = Number(cell.dataset.index);
                if (!animation.candidates.has(index)) continue;
                cell.classList.remove('dimmed');
                const bit = (index >> bitPosition) & 1;
                cell.classList.add(bit === requiredBit ? 'zone-valid' : 'zone-invalid');
            }
            elements.animationNextButton.textContent = 'Eliminovat červené';
            animation.phase = 'eliminate';
            return;
        }

        elements.animationText.textContent = `Oblast s ${variable} ≠ ${requiredBit} byla vyřazena.`;
        for (const cell of cells) {
            const index = Number(cell.dataset.index);
            if (!animation.candidates.has(index)) continue;
            if (cell.classList.contains('zone-invalid')) {
                cell.classList.remove('zone-invalid');
                cell.classList.add('dimmed');
                animation.candidates.delete(index);
            }
            cell.classList.remove('zone-valid');
        }
        animation.step += 1;
        animation.phase = 'show';
        elements.animationNextButton.textContent = 'Další podmínka';
    }

    function stopAnimation(shouldRender) {
        state.animation = null;
        if (elements.animationPanel) elements.animationPanel.hidden = true;
        if (elements.truthTable) {
            for (const row of elements.truthTable.querySelectorAll('tbody tr.active-row')) {
                row.classList.remove('active-row');
            }
        }
        if (shouldRender && elements.mapContainer) renderMap();
    }

    function getMapCells() {
        return Array.from(elements.mapContainer.querySelectorAll('.map-cell[data-index]'));
    }

    function markSolverDirty() {
        if (state.phase === Phase.COMPLETE) {
            state.phase = Phase.SOLVER;
            updatePhaseUi();
        }
        invalidateSolverFeedback();
    }

    function clearSelection() {
        if (state.selectedIndices.size === 0) return;
        markSolverDirty();
        state.selectedIndices.clear();
        elements.clearSelectionButton.disabled = true;
        renderMap();
    }

    function createGroupFromSelection() {
        markSolverDirty();
        const indices = Array.from(state.selectedIndices).sort((a, b) => a - b);
        if (indices.length === 0) {
            showMessage(elements.groupMessage, 'error', 'Nejprve v mapě označ buňky budoucí skupiny.');
            return;
        }
        if (!core.isPowerOfTwo(indices.length)) {
            showMessage(elements.groupMessage, 'error', `Skupina má ${indices.length} buněk. Povolené velikosti jsou 1, 2, 4, 8 a 16.`);
            return;
        }
        if (!core.isValidGroup(indices, state.variableCount)) {
            showMessage(elements.groupMessage, 'error', 'Vybrané buňky netvoří platný obdélník v Karnaughově mapě. Nezapomeň, že protilehlé okraje spolu sousedí.');
            return;
        }
        if (!indices.every(index => state.taskSet.has(index))) {
            showMessage(elements.groupMessage, 'error', 'Skupina obsahuje buňku s opačnou hodnotou funkce.');
            return;
        }
        if (state.groups.some(group => arraysEqual(group.indices, indices))) {
            showMessage(elements.groupMessage, 'error', 'Stejná skupina už existuje.');
            return;
        }
        if (!core.isGroupMaximal(indices, state.taskIndices, state.variableCount)) {
            showMessage(elements.groupMessage, 'error', 'Skupinu lze ještě zvětšit. V minimálním řešení používej maximální oblasti.');
            return;
        }

        const styleIndex = state.nextGroupId - 1;
        const literalStates = {};
        for (const variable of core.getVariableNames(state.variableCount)) {
            literalStates[variable] = LiteralState.OMITTED;
        }

        state.groups.push({
            id: state.nextGroupId,
            indices,
            color: GROUP_COLORS[styleIndex % GROUP_COLORS.length],
            borderStyle: GROUP_BORDER_STYLES[styleIndex % GROUP_BORDER_STYLES.length],
            literalStates
        });
        state.nextGroupId += 1;
        state.selectedIndices.clear();
        elements.clearSelectionButton.disabled = true;

        renderMap();
        renderGroups();
        updateEquation();

        const redundant = findRedundantGroupNumbers();
        if (redundant.length > 0) {
            showMessage(elements.groupMessage, 'hint', `Skupina ${redundant.join(', ')} je nyní pokryta ostatními skupinami. Před finální kontrolou ji pravděpodobně odstraň.`);
        }
    }

    function renderGroups() {
        elements.groupsList.replaceChildren();
        const variables = core.getVariableNames(state.variableCount);

        state.groups.forEach((group, position) => {
            const item = document.createElement('li');
            item.className = 'group-item';
            item.style.setProperty('--group-color', group.color);

            const heading = document.createElement('div');
            heading.className = 'group-heading';

            const title = document.createElement('strong');
            title.className = 'group-title';
            title.textContent = `Skupina ${position + 1}`;
            heading.appendChild(title);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'button button-ghost remove-group-button';
            removeButton.textContent = 'Smazat';
            removeButton.setAttribute('aria-label', `Smazat skupinu ${position + 1}`);
            removeButton.addEventListener('click', () => removeGroup(group.id));
            heading.appendChild(removeButton);
            item.appendChild(heading);

            const indices = document.createElement('p');
            indices.className = 'group-indices';
            indices.textContent = `Indexy: ${group.indices.join(', ')}`;
            item.appendChild(indices);

            const logic = core.getGroupLogic(group.indices, state.variableCount);
            if (logic.involvedVars.length === 0) {
                const note = document.createElement('p');
                note.className = 'constant-group-note';
                note.textContent = `Celá mapa tvoří konstantu ${state.solveMode === 'minterm' ? '1' : '0'}; žádné proměnné se nezachovají.`;
                item.appendChild(note);
            } else {
                const controls = document.createElement('div');
                controls.className = 'literal-buttons';
                for (const variable of variables) {
                    const button = document.createElement('button');
                    const literalState = group.literalStates[variable];
                    button.type = 'button';
                    button.className = `literal-button state-${literalState}`;
                    button.textContent = formatLiteralButton(variable, literalState);
                    button.setAttribute('aria-label', literalButtonAriaLabel(position + 1, variable, literalState));
                    button.addEventListener('click', () => toggleLiteral(group.id, variable));
                    controls.appendChild(button);
                }
                item.appendChild(controls);
            }

            elements.groupsList.appendChild(item);
        });
    }

    function formatLiteralButton(variable, literalState) {
        if (literalState === LiteralState.POSITIVE) return variable;
        if (literalState === LiteralState.NEGATED) return `¬${variable}`;
        return `${variable}: —`;
    }

    function literalButtonAriaLabel(groupNumber, variable, literalState) {
        const stateLabel = literalState === LiteralState.POSITIVE
            ? 'přímá forma'
            : literalState === LiteralState.NEGATED
                ? 'negovaná forma'
                : 'vynecháno';
        return `Skupina ${groupNumber}, proměnná ${variable}: ${stateLabel}. Změnit stav.`;
    }

    function toggleLiteral(groupId, variable) {
        markSolverDirty();
        const group = state.groups.find(candidate => candidate.id === groupId);
        if (!group) return;

        const order = [LiteralState.OMITTED, LiteralState.POSITIVE, LiteralState.NEGATED];
        const current = order.indexOf(group.literalStates[variable]);
        group.literalStates[variable] = order[(current + 1) % order.length];
        renderGroups();
        updateEquation();
    }

    function removeGroup(groupId) {
        markSolverDirty();
        state.groups = state.groups.filter(group => group.id !== groupId);
        renderMap();
        renderGroups();
        updateEquation();
    }

    function updateEquation() {
        if (state.phase === Phase.TABLE || state.phase === Phase.MAP) {
            elements.finalEquation.textContent = 'Y = …';
            return;
        }

        if (state.taskIndices.length === 0 && state.groups.length === 0) {
            elements.finalEquation.textContent = `Y = ${state.solveMode === 'minterm' ? '0' : '1'}`;
            return;
        }

        if (state.groups.length === 0) {
            elements.finalEquation.textContent = 'Y = …';
            return;
        }

        const terms = state.groups.map(group => formatUserGroupTerm(group));
        const joiner = state.solveMode === 'minterm' ? ' + ' : ' · ';
        elements.finalEquation.textContent = `Y = ${terms.join(joiner)}`;
    }

    function formatUserGroupTerm(group) {
        const logic = core.getGroupLogic(group.indices, state.variableCount);
        if (logic.involvedVars.length === 0) return state.solveMode === 'minterm' ? '1' : '0';

        const selectedVariables = core.getVariableNames(state.variableCount)
            .filter(variable => group.literalStates[variable] !== LiteralState.OMITTED);
        const expectedSet = new Set(logic.involvedVars);
        const completeVariableSet = selectedVariables.length === expectedSet.size
            && selectedVariables.every(variable => expectedSet.has(variable));

        const literals = selectedVariables.map(variable => (
            group.literalStates[variable] === LiteralState.NEGATED ? `¬${variable}` : variable
        ));

        if (state.solveMode === 'minterm') {
            if (literals.length === 0) return '[?]';
            return `${literals.join('·')}${completeVariableSet ? '' : '·?'}`;
        }

        if (literals.length === 0) return '(?)';
        return `(${literals.join(' + ')}${completeVariableSet ? '' : ' + ?'})`;
    }

    function checkFinalResult() {
        invalidateSolverFeedback();

        if (state.selectedIndices.size > 0) {
            showMessage(elements.finalMessage, 'error', 'V mapě zůstává rozpracovaný výběr. Vytvoř z něj skupinu nebo výběr zruš.');
            return;
        }

        if (state.taskIndices.length === 0) {
            if (state.groups.length > 0) {
                showMessage(elements.finalMessage, 'error', 'Funkce je konstantní a nevyžaduje žádnou skupinu. Odstraň vytvořené skupiny.');
                return;
            }
            completeExercise(`Správně. Jde o konstantní funkci Y = ${state.solveMode === 'minterm' ? '0' : '1'}; nejsou potřeba žádné členy.`);
            return;
        }

        const coverage = core.coverTargets(state.groups, state.taskIndices, state.variableCount);
        if (coverage.outside.length > 0) {
            showMessage(elements.finalMessage, 'error', `Skupiny zasahují i do necílových buněk ${formatIndices(coverage.outside)}.`);
            return;
        }
        if (coverage.missing.length > 0) {
            showMessage(elements.finalMessage, 'error', `Nejsou pokryté cílové buňky ${formatIndices(coverage.missing)}.`);
            return;
        }

        for (let position = 0; position < state.groups.length; position += 1) {
            const group = state.groups[position];
            if (!core.isValidGroup(group.indices, state.variableCount)) {
                showMessage(elements.finalMessage, 'error', `Skupina ${position + 1} nemá platný tvar.`);
                return;
            }
            if (!core.isGroupMaximal(group.indices, state.taskIndices, state.variableCount)) {
                showMessage(elements.finalMessage, 'error', `Skupina ${position + 1} není maximální a lze ji zvětšit.`);
                return;
            }
        }

        const redundant = findRedundantGroupNumbers();
        if (redundant.length > 0) {
            showMessage(elements.finalMessage, 'error', `Nadbytečné skupiny: ${redundant.join(', ')}. Jejich buňky už pokrývají ostatní skupiny.`);
            return;
        }

        const variableErrors = collectVariableErrors();
        if (variableErrors.length > 0) {
            showMessage(elements.finalMessage, 'error', variableErrors.join('\n'));
            return;
        }

        const userCost = core.getCoverCost(state.groups, state.variableCount);
        const optimalCost = state.optimalSolution.cost;
        if (core.compareCost(userCost, optimalCost) > 0) {
            const termDifference = userCost.terms - optimalCost.terms;
            const reason = termDifference > 0
                ? `používá o ${termDifference} ${termDifference === 1 ? 'člen' : 'členy'} více`
                : `používá více literálů (${userCost.literals} místo ${optimalCost.literals})`;
            showMessage(
                elements.finalMessage,
                'error',
                `Výraz je logicky správný, ale není minimální: ${reason}. Tvoje cena je ${formatCost(userCost)}, minimum je ${formatCost(optimalCost)}.`
            );
            return;
        }

        completeExercise(`Výborně. Řešení je správné a globálně minimální (${formatCost(userCost)}).`);
    }

    function completeExercise(message) {
        state.phase = Phase.COMPLETE;
        updateEquation();
        updatePhaseUi();
        showMessage(elements.finalMessage, 'success', message);
    }

    function collectVariableErrors() {
        const errors = [];
        const variables = core.getVariableNames(state.variableCount);

        state.groups.forEach((group, position) => {
            const expected = core.getExpectedLiteralStates(group.indices, state.variableCount, state.solveMode);
            for (const variable of variables) {
                const actualState = group.literalStates[variable];
                const expectedState = expected[variable] ?? LiteralState.OMITTED;

                if (actualState === expectedState) continue;
                if (expectedState === LiteralState.OMITTED) {
                    errors.push(`Skupina ${position + 1}: ${variable} se uvnitř skupiny mění, proto musí být vynechána.`);
                } else if (actualState === LiteralState.OMITTED) {
                    errors.push(`Skupina ${position + 1}: ${variable} je v celé skupině konstantní a ve výrazu chybí.`);
                } else {
                    errors.push(`Skupina ${position + 1}: u proměnné ${variable} je obrácená negace.`);
                }
            }
        });

        return errors;
    }

    function findRedundantGroupNumbers() {
        const redundant = [];
        state.groups.forEach((group, position) => {
            const coveredByOthers = new Set();
            state.groups.forEach((other, otherPosition) => {
                if (position === otherPosition) return;
                other.indices.forEach(index => coveredByOthers.add(index));
            });
            if (group.indices.every(index => coveredByOthers.has(index))) redundant.push(position + 1);
        });
        return redundant;
    }

    function showSmartHint() {
        hideMessage(elements.finalMessage);
        hideMessage(elements.groupMessage);

        if (state.taskIndices.length === 0) {
            showMessage(elements.hintMessage, 'hint', `Mapa neobsahuje žádné cílové buňky. Výsledek je přímo konstanta Y = ${state.solveMode === 'minterm' ? '0' : '1'} a nevytváří se žádná skupina.`);
            return;
        }

        const selection = Array.from(state.selectedIndices).sort((a, b) => a - b);
        if (selection.length > 0) {
            if (!core.isPowerOfTwo(selection.length)) {
                showMessage(elements.hintMessage, 'hint', `Aktuální výběr má ${selection.length} buněk. Doplň nebo odeber buňky tak, aby velikost byla mocninou dvou.`);
                return;
            }
            if (!core.isValidGroup(selection, state.variableCount)) {
                showMessage(elements.hintMessage, 'hint', 'Aktuální výběr není logická krychle. Hledej obdélník; spojení přes levý/pravý nebo horní/dolní okraj je povolené.');
                return;
            }
            if (!core.isGroupMaximal(selection, state.taskIndices, state.variableCount)) {
                showMessage(elements.hintMessage, 'hint', 'Tvar je platný, ale lze jej zvětšit o sousední cílové buňky. Větší skupina odstraní více proměnných.');
                return;
            }
            showMessage(elements.hintMessage, 'hint', 'Aktuální výběr tvoří platnou maximální skupinu. Můžeš ji přidat.');
            return;
        }

        const coverage = core.coverTargets(state.groups, state.taskIndices, state.variableCount);
        if (coverage.missing.length > 0) {
            const missingSet = new Set(coverage.missing);
            const optimalCandidates = state.optimalSolution.cover
                .filter(group => group.indices.some(index => missingSet.has(index)));
            const candidatePool = optimalCandidates.length > 0
                ? optimalCandidates
                : state.optimalSolution.primeImplicants.filter(prime => (
                    prime.indices.some(index => missingSet.has(index))
                ));
            const candidate = candidatePool
                .slice()
                .sort((left, right) => {
                    const leftGain = left.indices.filter(index => missingSet.has(index)).length;
                    const rightGain = right.indices.filter(index => missingSet.has(index)).length;
                    return rightGain - leftGain || right.cellCount - left.cellCount || left.literalCount - right.literalCount;
                })[0];

            if (candidate) {
                highlightIndices(candidate.indices);
                showMessage(
                    elements.hintMessage,
                    'hint',
                    `Začni nepokrytým indexem ${coverage.missing[0]}. Jedna vhodná maximální skupina má ${candidate.cellCount} buněk: ${formatIndices(candidate.indices)}.`
                );
                return;
            }
        }

        const redundant = findRedundantGroupNumbers();
        if (redundant.length > 0) {
            showMessage(elements.hintMessage, 'hint', `Skupina ${redundant[0]} nepřináší žádné nové pokrytí. Zkus ji odstranit.`);
            return;
        }

        const variableErrors = collectVariableErrors();
        if (variableErrors.length > 0) {
            showMessage(elements.hintMessage, 'hint', variableErrors[0]);
            return;
        }

        const userCost = core.getCoverCost(state.groups, state.variableCount);
        const optimalCost = state.optimalSolution.cost;
        if (core.compareCost(userCost, optimalCost) > 0) {
            const userKeys = new Set(state.groups.map(group => group.indices.join(',')));
            const suggested = state.optimalSolution.cover.find(group => !userKeys.has(group.indices.join(',')))
                ?? state.optimalSolution.cover[0];
            if (suggested) highlightIndices(suggested.indices);
            showMessage(
                elements.hintMessage,
                'hint',
                `Pokrytí je úplné, ale minimum je ${formatCost(optimalCost)}. Zkus přeuspořádat skupiny; zvýrazněná oblast patří do jednoho optimálního řešení.`
            );
            return;
        }

        showMessage(elements.hintMessage, 'hint', 'Pokrytí i proměnné vypadají správně. Proveď finální kontrolu.');
    }

    function highlightIndices(indices) {
        if (state.hintTimer !== null) window.clearTimeout(state.hintTimer);
        for (const cell of getMapCells()) cell.classList.remove('hint-highlight');
        for (const index of indices) {
            const cell = elements.mapContainer.querySelector(`.map-cell[data-index="${index}"]`);
            if (cell) cell.classList.add('hint-highlight');
        }
        state.hintTimer = window.setTimeout(() => {
            for (const cell of getMapCells()) cell.classList.remove('hint-highlight');
            state.hintTimer = null;
        }, 2300);
    }

    function invalidateSolverFeedback() {
        hideMessage(elements.hintMessage);
        hideMessage(elements.groupMessage);
        hideMessage(elements.finalMessage);
    }

    function hideAllMessages() {
        for (const element of [
            elements.tableMessage,
            elements.mapMessage,
            elements.hintMessage,
            elements.groupMessage,
            elements.finalMessage
        ]) {
            hideMessage(element);
        }
    }

    function showMessage(element, type, text) {
        element.className = 'status-message is-visible';
        if (type === 'error') element.classList.add('is-error');
        if (type === 'success') element.classList.add('is-success');
        if (type === 'hint') element.classList.add('is-hint');
        element.textContent = text;
    }

    function hideMessage(element) {
        element.className = element === elements.hintMessage
            ? 'status-message status-hint'
            : 'status-message';
        element.textContent = '';
    }

    function formatIndices(indices) {
        return indices.length === 0 ? '∅' : indices.join(', ');
    }

    function formatCost(cost) {
        const termWord = cost.terms === 1 ? 'člen' : cost.terms >= 2 && cost.terms <= 4 ? 'členy' : 'členů';
        const literalWord = cost.literals === 1 ? 'literál' : cost.literals >= 2 && cost.literals <= 4 ? 'literály' : 'literálů';
        return `${cost.terms} ${termWord}, ${cost.literals} ${literalWord}`;
    }

    function arraysEqual(left, right) {
        return left.length === right.length && left.every((value, position) => value === right[position]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
