(function () {
    'use strict';

    const core = window.KMapCore;
    const presentation = window.KMapPresentation;
    if (!presentation) throw new Error('Prezentační modul nebyl načten.');
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
        activeGroupId: null,
        animation: null,
        hintTimer: null
    };

    const elements = {};
    let geometryObserver = null;
    let geometryFrame = null;
    let currentMapGeometry = null;

    function scheduleGeometryRefresh() {
        if (geometryFrame !== null) return;
        geometryFrame = window.requestAnimationFrame(() => {
            geometryFrame = null;
            refreshMapGeometry();
        });
    }

    function refreshMapGeometry() {
        const context = currentMapGeometry;
        if (!context || !context.diagram.isConnected) return;
        const { diagram, table, divider, layout, lanes } = context;
        if (divider) positionFiveVariableDivider(diagram, table, divider);
        renderGroupOverlay(diagram, layout, lanes);
        refreshActiveGroupVisuals();
        if (state.animation && ['ready-to-transfer', 'transferred'].includes(state.animation.phase)) {
            keepMapCellVisible(state.animation.rowIndex);
        }
    }

    function observeMapGeometry(context) {
        geometryObserver?.disconnect();
        if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame);
        geometryFrame = null;
        currentMapGeometry = context;
        if (typeof ResizeObserver === 'function') {
            geometryObserver = new ResizeObserver(scheduleGeometryRefresh);
            // Pozorujeme i vodicí pruhy a mobilní výřez, nikoli jen okno.
            for (const element of [context.diagram, context.table, elements.mapContainer.parentElement]) {
                geometryObserver.observe(element);
            }
        }
        refreshMapGeometry();
    }

    function diagramCoordinates(diagram) {
        const rect = diagram.getBoundingClientRect();
        const style = window.getComputedStyle(diagram);
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        const scaleX = rect.width / width;
        const scaleY = rect.height / height;
        return {
            width, height,
            // CSS zoom/transform nesmí být započten dvakrát při převodu do SVG.
            rectOf(element) {
                const box = element.getBoundingClientRect();
                return {
                    left: (box.left - rect.left) / scaleX,
                    top: (box.top - rect.top) / scaleY,
                    right: (box.right - rect.left) / scaleX,
                    bottom: (box.bottom - rect.top) / scaleY,
                    width: box.width / scaleX, height: box.height / scaleY
                };
            }
        };
    }

    function captureCellFocus(container) {
        const active = document.activeElement;
        if (!container.contains(active)) return null;
        const index = active.closest('[data-index]')?.dataset.index;
        if (index === undefined) return null;
        const kind = active.classList.contains('map-cell') ? 'map-cell'
            : active.classList.contains('output-button') ? 'output-button' : 'eye-button';
        return { index, kind };
    }

    function restoreCellFocus(container, saved) {
        if (!saved) return;
        const target = saved.kind === 'map-cell'
            ? container.querySelector(`.map-cell[data-index="${saved.index}"]`)
            : container.querySelector(`tr[data-index="${saved.index}"] .${saved.kind}`);
        if (target && !target.disabled) target.focus({ preventScroll: true });
    }

    function keepMapCellVisible(index) {
        const cell = elements.mapContainer.querySelector(`.map-cell[data-index="${index}"]`)?.closest('td');
        const stage = elements.mapContainer.closest('.map-stage');
        if (!cell || !stage) return;
        const frame = stage.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        const css = window.getComputedStyle(stage);
        const scaleX = frame.width / parseFloat(css.width);
        const scaleY = frame.height / parseFloat(css.height);
        const left = frame.left + (stage.clientLeft + 8) * scaleX;
        const right = frame.left + (stage.clientLeft + stage.clientWidth - 8) * scaleX;
        const top = frame.top + (stage.clientTop + 8) * scaleY;
        const bottom = frame.top + (stage.clientTop + stage.clientHeight - 8) * scaleY;
        if (box.left < left) stage.scrollLeft += (box.left - left) / scaleX;
        else if (box.right > right) stage.scrollLeft += (box.right - right) / scaleX;
        if (box.top < top) stage.scrollTop += (box.top - top) / scaleY;
        else if (box.bottom > bottom) stage.scrollTop += (box.bottom - bottom) / scaleY;
    }


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
            'mapHelpButton', 'checkMapButton', 'skipMapButton', 'mapMessage',
            'solverPanel', 'solverStepState',
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
        elements.mapHelpButton.addEventListener('click', startMapHelp);
        elements.checkMapButton.addEventListener('click', checkMap);
        elements.skipMapButton.addEventListener('click', fillMapAutomatically);
        elements.animationNextButton.addEventListener('click', nextAnimationStep);
        elements.animationStopButton.addEventListener('click', () => stopAnimation(true));

        elements.createGroupButton.addEventListener('click', createGroupFromSelection);
        elements.clearSelectionButton.addEventListener('click', clearSelection);
        elements.hintButton.addEventListener('click', showSmartHint);
        elements.checkFinalButton.addEventListener('click', checkFinalResult);
        window.addEventListener('resize', scheduleGeometryRefresh, { passive: true });
        window.visualViewport?.addEventListener('resize', scheduleGeometryRefresh, { passive: true });
        document.fonts?.ready.then(scheduleGeometryRefresh);
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
        state.activeGroupId = null;

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
        const targetSingular = state.solveMode === 'minterm' ? 'jednička' : 'nula';
        const targetPlural = state.solveMode === 'minterm' ? 'jedničky' : 'nuly';
        const targetTypePlural = state.solveMode === 'minterm' ? 'mintermy' : 'maxtermy';
        elements.taskIndices.textContent = `Y = ${notation}(${indices})`;

        if (state.taskIndices.length === 0) {
            elements.taskMeaning.textContent = `Nejsou zadány žádné ${targetTypePlural}.`;
        } else if (state.taskIndices.length === 1) {
            elements.taskMeaning.textContent = `Na uvedeném indexu musí být ${targetSingular}.`;
        } else {
            elements.taskMeaning.textContent = `Na uvedených indexech musí být ${targetPlural}.`;
        }
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
        const mapBusy = Boolean(state.animation);
        elements.mapHelpButton.disabled = state.phase !== Phase.MAP || mapBusy;
        elements.checkMapButton.disabled = state.phase !== Phase.MAP || mapBusy;
        elements.skipMapButton.disabled = state.phase !== Phase.MAP || mapBusy;

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
        const savedFocus = captureCellFocus(table);
        const scroller = table.closest('.truth-table-container');
        const savedScroll = scroller.scrollTop;
        table.replaceChildren();

        const caption = document.createElement('caption');
        caption.className = 'sr-only';
        caption.textContent = 'Pravdivostní tabulka zadané logické funkce';
        table.appendChild(caption);

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const hintHeader = document.createElement('th');
        hintHeader.scope = 'col';
        hintHeader.textContent = 'Nápověda';
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
        const canAnimate = state.phase === Phase.MAP && !state.animation;
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
            outputButton.setAttribute('aria-label', `Index ${index}, hodnota Y: ${value === null ? 'nevyplněná' : value}. Změnit hodnotu.`);
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
        scroller.scrollTop = savedScroll;
        restoreCellFocus(table, savedFocus);
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
        showMessage(elements.tableMessage, 'success', 'Tabulka je správně. Nyní přenes každou hodnotu Y do buňky se stejným indexem N.');
    }

    function fillTruthTableAutomatically() {
        state.tableValues = state.tableValues.map((_, index) => expectedValue(index));
        state.tableErrors.clear();
        state.phase = Phase.MAP;
        updatePhaseUi();
        showMessage(elements.tableMessage, 'success', 'Tabulka byla vyplněna automaticky. Pokračuj přepisem hodnot do mapy.');
    }

    function renderMap() {
        const savedFocus = captureCellFocus(elements.mapContainer);
        const stage = elements.mapContainer.closest('.map-stage');
        const savedScroll = { left: stage.scrollLeft, top: stage.scrollTop };
        const layout = core.getMapLayout(state.variableCount);
        const diagram = document.createElement('div');
        diagram.className = 'kmap-diagram';
        diagram.style.setProperty('--map-column-count', String(layout.columns.length));
        diagram.style.setProperty('--map-row-count', String(layout.rows.length));
        diagram.style.setProperty('--column-guide-count', String(layout.columnGuides.length));
        diagram.style.setProperty('--row-guide-count', String(layout.rowGuides.length));

        const columnGuides = createVariableGuideLayer(layout.columnGuides, 'column');
        const rowGuides = createVariableGuideLayer(layout.rowGuides, 'row');
        const fiveVariableDivider = state.variableCount === 5
            ? createFiveVariableDivider()
            : null;

        const table = document.createElement('table');
        table.className = 'kmap-table';
        table.setAttribute(
            'aria-label',
            `Karnaughova mapa. Čáry nad mapou a vlevo vyznačují oblasti, ve kterých mají proměnné ${core.getVariableNames(state.variableCount).join(', ')} hodnotu jedna.`
        );

        const tbody = document.createElement('tbody');
        const solverMode = state.phase === Phase.SOLVER || state.phase === Phase.COMPLETE;
        const outlineLanes = core.assignGroupOutlineLanes(state.groups);
        const outlineLaneByGroupId = new Map(
            state.groups.map((group, groupPosition) => [group.id, outlineLanes[groupPosition]])
        );
        const laneCount = outlineLanes.length ? Math.max(...outlineLanes) + 1 : 0;
        diagram.style.setProperty('--dense-cell-size', `${presentation.minimumCellSize(laneCount)}px`);

        for (let rowPosition = 0; rowPosition < layout.rows.length; rowPosition += 1) {
            const row = document.createElement('tr');

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
                    participating.forEach(({ group, groupPosition }) => {
                        const badge = document.createElement('span');
                        badge.className = 'group-badge';
                        badge.dataset.groupId = String(group.id);
                        badge.style.backgroundColor = group.color;
                        badge.textContent = String(groupPosition + 1);
                        badges.appendChild(badge);
                    });
                    if (participating.length > 3) {
                        button.classList.add('has-many-groups');
                        const summary = document.createElement('span');
                        summary.className = 'group-badge-summary';
                        summary.dataset.count = String(participating.length);
                        summary.textContent = `×${participating.length}`;
                        summary.title = `Skupiny: ${participating.map(entry => entry.groupPosition + 1).join(', ')}`;
                        badges.appendChild(summary);
                    }
                    button.appendChild(badges);
                }

                if (state.phase === Phase.MAP) {
                    button.disabled = Boolean(state.animation);
                    button.setAttribute('aria-label', `Index ${index}, hodnota: ${value === null ? 'nevyplněná' : value}. Změnit hodnotu mapy.`);
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
        if (fiveVariableDivider) diagram.appendChild(fiveVariableDivider);
        elements.mapPanel.classList.toggle('has-five-variable-map', state.variableCount === 5);
        elements.mapContainer.classList.toggle('map-container-five', state.variableCount === 5);
        elements.mapContainer.replaceChildren(diagram);
        observeMapGeometry({ diagram, table, divider: fiveVariableDivider, layout, lanes: outlineLaneByGroupId });
        stage.scrollLeft = savedScroll.left;
        stage.scrollTop = savedScroll.top;
        restoreCellFocus(elements.mapContainer, savedFocus);
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
                segment.style.setProperty('--guide-grid-start', String(run.start + 1));
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

    function renderGroupOverlay(diagram, layout, outlineLaneByGroupId) {
        diagram.querySelector('.group-overlay')?.remove();
        if (state.groups.length === 0) return;
        const table = diagram.querySelector('.kmap-table');
        if (!table) return;
        const coordinates = diagramCoordinates(diagram);
        const sizes = [...table.querySelectorAll('td')].map(cell => coordinates.rectOf(cell));
        const minCellSize = Math.min(...sizes.flatMap(rect => [rect.width, rect.height]));
        const laneCount = Math.max(...outlineLaneByGroupId.values()) + 1;
        const insets = presentation.outlineInsets(laneCount, minCellSize);
        const radius = Math.max(5, Math.round(minCellSize * 0.12));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('group-overlay');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', `0 0 ${coordinates.width} ${coordinates.height}`);

        state.groups.forEach((group, groupPosition) => {
            const lane = outlineLaneByGroupId.get(group.id) ?? 0;
            const inset = insets[lane];
            const visual = core.getGroupVisualGeometry(group.indices, state.variableCount);
            const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.classList.add('group-shape');
            wrapper.dataset.groupId = String(group.id);
            wrapper.dataset.outlineLane = String(lane);
            wrapper.dataset.inset = String(inset);
            wrapper.style.setProperty('--group-color', group.color);
            wrapper.setAttribute('stroke', group.color);
            wrapper.setAttribute('fill', 'none');
            wrapper.setAttribute('stroke-linecap', 'round');
            wrapper.setAttribute('stroke-linejoin', 'round');
            wrapper.setAttribute('stroke-width', '2');

            visual.boxes.forEach(box => {
                // Skutečné hrany krajních buněk, ne násobení šířky první buňky.
                const first = coordinates.rectOf(table.rows[box.rowStart].cells[box.columnStart]);
                const last = coordinates.rectOf(table.rows[box.rowStart + box.rowSpan - 1]
                    .cells[box.columnStart + box.columnSpan - 1]);
                const x = first.left + inset;
                const y = first.top + inset;
                const width = last.right - first.left - 2 * inset;
                const height = last.bottom - first.top - 2 * inset;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.classList.add('group-outline');
                path.dataset.groupId = String(group.id);
                path.dataset.groupIndex = String(groupPosition + 1);
                path.dataset.width = String(width);
                path.dataset.height = String(height);
                path.dataset.openSides = [
                    box.openTop ? 'top' : '', box.openRight ? 'right' : '',
                    box.openBottom ? 'bottom' : '', box.openLeft ? 'left' : ''
                ].filter(Boolean).join(',');
                // Přesah je vždy 14 px ZA mapou, nezkracuje se s vyšší kolejí.
                path.setAttribute('d', createOpenGroupPath(x, y, width, height, radius, 14 + inset, box));
                wrapper.appendChild(path);
            });
            svg.appendChild(wrapper);
        });
        diagram.appendChild(svg);
    }

    function createOpenGroupPath(x, y, width, height, radius, stubLength, box) {
        const openTop = Boolean(box.openTop);
        const openRight = Boolean(box.openRight);
        const openBottom = Boolean(box.openBottom);
        const openLeft = Boolean(box.openLeft);
        const r = Math.max(0, Math.min(radius, width / 2, height / 2));
        const right = x + width;
        const bottom = y + height;

        if (!openTop && !openRight && !openBottom && !openLeft) {
            return [
                `M ${x + r} ${y}`,
                `H ${right - r}`,
                `Q ${right} ${y} ${right} ${y + r}`,
                `V ${bottom - r}`,
                `Q ${right} ${bottom} ${right - r} ${bottom}`,
                `H ${x + r}`,
                `Q ${x} ${bottom} ${x} ${bottom - r}`,
                `V ${y + r}`,
                `Q ${x} ${y} ${x + r} ${y}`,
                'Z'
            ].join(' ');
        }

        if (openLeft && !openTop && !openBottom) {
            return [
                `M ${x - stubLength} ${y}`,
                `H ${right - r}`,
                `Q ${right} ${y} ${right} ${y + r}`,
                `V ${bottom - r}`,
                `Q ${right} ${bottom} ${right - r} ${bottom}`,
                `H ${x - stubLength}`
            ].join(' ');
        }

        if (openRight && !openTop && !openBottom) {
            return [
                `M ${right + stubLength} ${y}`,
                `H ${x + r}`,
                `Q ${x} ${y} ${x} ${y + r}`,
                `V ${bottom - r}`,
                `Q ${x} ${bottom} ${x + r} ${bottom}`,
                `H ${right + stubLength}`
            ].join(' ');
        }

        if (openTop && !openLeft && !openRight) {
            return [
                `M ${x} ${y - stubLength}`,
                `V ${bottom - r}`,
                `Q ${x} ${bottom} ${x + r} ${bottom}`,
                `H ${right - r}`,
                `Q ${right} ${bottom} ${right} ${bottom - r}`,
                `V ${y - stubLength}`
            ].join(' ');
        }

        if (openBottom && !openLeft && !openRight) {
            return [
                `M ${x} ${bottom + stubLength}`,
                `V ${y + r}`,
                `Q ${x} ${y} ${x + r} ${y}`,
                `H ${right - r}`,
                `Q ${right} ${y} ${right} ${y + r}`,
                `V ${bottom + stubLength}`
            ].join(' ');
        }

        if (openTop && openLeft) {
            return [
                `M ${right} ${y - stubLength}`,
                `V ${bottom - r}`,
                `Q ${right} ${bottom} ${right - r} ${bottom}`,
                `H ${x - stubLength}`
            ].join(' ');
        }

        if (openTop && openRight) {
            return [
                `M ${x} ${y - stubLength}`,
                `V ${bottom - r}`,
                `Q ${x} ${bottom} ${x + r} ${bottom}`,
                `H ${right + stubLength}`
            ].join(' ');
        }

        if (openBottom && openLeft) {
            return [
                `M ${x - stubLength} ${y}`,
                `H ${right - r}`,
                `Q ${right} ${y} ${right} ${y + r}`,
                `V ${bottom + stubLength}`
            ].join(' ');
        }

        if (openBottom && openRight) {
            return [
                `M ${right + stubLength} ${y}`,
                `H ${x + r}`,
                `Q ${x} ${y} ${x} ${y + r}`,
                `V ${bottom + stubLength}`
            ].join(' ');
        }

        return '';
    }

    function createFiveVariableDivider() {
        const divider = document.createElement('span');
        divider.className = 'five-variable-divider';
        divider.setAttribute('aria-hidden', 'true');

        const topSegment = document.createElement('span');
        topSegment.className = 'five-variable-divider-segment top';
        divider.appendChild(topSegment);

        const bottomSegment = document.createElement('span');
        bottomSegment.className = 'five-variable-divider-segment bottom';
        divider.appendChild(bottomSegment);

        return divider;
    }

    function positionFiveVariableDivider(diagram, table, divider) {
        const firstRow = table.rows[0];
        if (!firstRow || firstRow.cells.length !== 8) return;
        const coordinates = diagramCoordinates(diagram);
        const reference = firstRow.cells[3];
        const button = reference.querySelector('.map-cell');
        const border = parseFloat(window.getComputedStyle(button).borderRightWidth) || 1;
        const cell = coordinates.rectOf(reference);
        const grid = coordinates.rectOf(table);
        divider.style.left = `${cell.right - border}px`;
        divider.style.setProperty('--divider-width', `${border}px`);
        divider.dataset.axisBoundary = String(cell.right);
        const top = divider.querySelector('.top');
        const bottom = divider.querySelector('.bottom');
        // Dva krátké náznaky; žádný tah ani podklad uvnitř mřížky.
        top.style.top = `${grid.top - 18}px`;
        top.style.height = '15px';
        bottom.style.top = `${grid.bottom + 3}px`;
        bottom.style.height = '15px';
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
            setActiveGroup(null);
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
        advanceToSolver('Mapa je správně. Minimalizace byla odemčena.');
    }

    function fillMapAutomatically() {
        if (state.phase !== Phase.MAP) return;
        stopAnimation(false);
        state.mapValues = state.tableValues.slice();
        state.mapErrors.clear();
        advanceToSolver('Vyplnění mapy bylo přeskočeno. Hodnoty byly přeneseny automaticky a minimalizace je odemčena.');
    }

    function advanceToSolver(message) {
        state.phase = Phase.SOLVER;
        const targetWord = state.solveMode === 'minterm' ? 'jedničky' : 'nuly';
        const groupSizes = Array.from(
            { length: state.variableCount + 1 },
            (_, power) => 2 ** power
        ).join(', ');
        elements.solverInstruction.textContent = `Označ sousední ${targetWord} ve skupinách velikosti ${groupSizes}. Poté u každé skupiny urči konstantní proměnné.`;
        updateEquation();
        updatePhaseUi();
        showMessage(elements.mapMessage, 'success', message);
    }

    function startMapHelp() {
        if (state.phase !== Phase.MAP) return;
        const nextIndex = findNextMapHelpIndex();
        if (nextIndex === null) {
            showMessage(elements.mapMessage, 'success', 'Všechny hodnoty v mapě už odpovídají pravdivostní tabulce. Můžeš spustit kontrolu.');
            return;
        }
        startAnimation(nextIndex);
    }

    function findNextMapHelpIndex(afterIndex = -1) {
        const mismatched = [];
        const incomplete = [];

        for (let index = 0; index < state.mapValues.length; index += 1) {
            if (state.mapValues[index] === state.tableValues[index]) continue;
            mismatched.push(index);
            if (state.mapValues[index] === null) incomplete.push(index);
        }

        const candidates = incomplete.length > 0 ? incomplete : mismatched;
        if (candidates.length === 0) return null;
        return candidates.find(index => index > afterIndex) ?? candidates[0];
    }

    function startAnimation(rowIndex) {
        if (state.phase !== Phase.MAP || state.tableValues[rowIndex] === null) return;
        stopAnimation(false);

        const candidates = new Set();
        for (let index = 0; index < core.totalCellCount(state.variableCount); index += 1) {
            candidates.add(index);
        }

        state.animation = {
            rowIndex,
            sourceValue: state.tableValues[rowIndex],
            step: 0,
            phase: 'show',
            candidates
        };

        hideMessage(elements.mapMessage);
        updatePhaseUi();

        const row = elements.truthTable.querySelector(`tbody tr[data-index="${rowIndex}"]`);
        if (row) {
            row.classList.add('active-row');
            keepTruthTableRowVisible(row);
        }

        elements.animationPanel.hidden = false;
        elements.animationNextButton.textContent = 'Začít hledání';
        const assignment = core.getVariableNames(state.variableCount)
            .map((variable, bitPosition) => `${variable}=${(rowIndex >> bitPosition) & 1}`)
            .join(', ');
        elements.animationText.textContent = `Řádek N = ${rowIndex} má ${assignment} a hodnotu Y = ${state.animation.sourceValue}. Postupně zúžíme mapu na jedinou buňku.`;

        for (const cell of getMapCells()) cell.classList.add('dimmed');
        elements.animationNextButton.focus({ preventScroll: true });
    }

    function keepTruthTableRowVisible(row) {
        const container = row.closest('.truth-table-container');
        if (!container) return;
        const rowTop = row.offsetTop;
        const rowBottom = rowTop + row.offsetHeight;
        if (rowTop < container.scrollTop) {
            container.scrollTop = rowTop;
        } else if (rowBottom > container.scrollTop + container.clientHeight) {
            container.scrollTop = rowBottom - container.clientHeight;
        }
    }

    function nextAnimationStep() {
        if (!state.animation) return;

        if (state.animation.phase === 'ready-to-transfer') {
            transferAnimationValue();
            return;
        }

        if (state.animation.phase === 'transferred') {
            const nextIndex = findNextMapHelpIndex(state.animation.rowIndex);
            if (nextIndex === null) {
                stopAnimation(true);
                showMessage(elements.mapMessage, 'success', 'Interaktivní přepis je hotový. Všechny hodnoty odpovídají tabulce; nyní mapu zkontroluj.');
            } else {
                startAnimation(nextIndex);
            }
            return;
        }

        const animation = state.animation;
        const variables = core.getVariableNames(state.variableCount);
        const cells = getMapCells();

        if (animation.step >= state.variableCount) {
            clearGuideHighlights();
            const target = elements.mapContainer.querySelector(`.map-cell[data-index="${animation.rowIndex}"]`);
            if (target) {
                target.classList.remove('dimmed', 'zone-valid', 'zone-invalid');
                target.classList.add('target-pulse');
                keepMapCellVisible(animation.rowIndex);
            }
            elements.animationText.textContent = `Cíl N = ${animation.rowIndex} je nalezen. Z aktivního řádku tabulky do něj patří hodnota Y = ${animation.sourceValue}.`;
            elements.animationNextButton.textContent = `Přenést Y = ${animation.sourceValue}`;
            animation.phase = 'ready-to-transfer';
            return;
        }

        const variable = variables[animation.step];
        const bitPosition = animation.step;
        const requiredBit = (animation.rowIndex >> bitPosition) & 1;

        if (animation.phase === 'show') {
            highlightVariableGuide(variable, requiredBit);
            elements.animationText.textContent = `Krok ${animation.step + 1} z ${state.variableCount}: ${variable} = ${requiredBit}. Zelené buňky vyhovují, červené v dalším kroku vyřadíme.`;
            for (const cell of cells) {
                const index = Number(cell.dataset.index);
                if (!animation.candidates.has(index)) continue;
                cell.classList.remove('dimmed');
                const bit = (index >> bitPosition) & 1;
                cell.classList.add(bit === requiredBit ? 'zone-valid' : 'zone-invalid');
            }
            elements.animationNextButton.textContent = 'Vyřadit červené buňky';
            animation.phase = 'eliminate';
            return;
        }

        elements.animationText.textContent = `Buňky s ${variable} ≠ ${requiredBit} jsou vyřazené.`;
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
        elements.animationNextButton.textContent = animation.step >= state.variableCount
            ? 'Ukázat cílovou buňku'
            : 'Další proměnná';
    }

    function transferAnimationValue() {
        const animation = state.animation;
        if (!animation) return;

        state.mapValues[animation.rowIndex] = animation.sourceValue;
        state.mapErrors.delete(animation.rowIndex);
        animation.phase = 'transferred';
        clearGuideHighlights();
        renderMap();

        const target = elements.mapContainer.querySelector(`.map-cell[data-index="${animation.rowIndex}"]`);
        if (target) {
            target.classList.add('target-pulse');
            keepMapCellVisible(animation.rowIndex);
        }

        const nextIndex = findNextMapHelpIndex(animation.rowIndex);
        elements.animationText.textContent = `Hodnota Y = ${animation.sourceValue} byla přenesena do buňky N = ${animation.rowIndex}.`;
        elements.animationNextButton.textContent = nextIndex === null
            ? 'Dokončit nápovědu'
            : `Pokračovat indexem N = ${nextIndex}`;
    }

    function highlightVariableGuide(variable, requiredBit) {
        clearGuideHighlights();
        for (const guide of elements.mapContainer.querySelectorAll(`.variable-guide[data-variable="${variable}"]`)) {
            guide.classList.add('is-help-active');
            guide.dataset.requiredBit = String(requiredBit);
        }
    }

    function clearGuideHighlights() {
        if (!elements.mapContainer) return;
        for (const guide of elements.mapContainer.querySelectorAll('.variable-guide')) {
            guide.classList.remove('is-help-active', 'is-help-complement');
            delete guide.dataset.requiredBit;
        }
    }

    function stopAnimation(shouldRender) {
        const restoreFocus = elements.animationPanel?.contains(document.activeElement);
        state.animation = null;
        if (elements.animationPanel) elements.animationPanel.hidden = true;
        clearGuideHighlights();
        if (elements.truthTable) {
            for (const row of elements.truthTable.querySelectorAll('tbody tr.active-row')) {
                row.classList.remove('active-row');
            }
        }
        if (shouldRender && elements.mapContainer) {
            updatePhaseUi();
            if (restoreFocus) elements.mapHelpButton.focus({ preventScroll: true });
        }
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
        setActiveGroup(null);
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
            const allowedSizes = Array.from(
                { length: state.variableCount + 1 },
                (_, power) => 2 ** power
            ).join(', ');
            showMessage(elements.groupMessage, 'error', `Skupina má ${formatCellCount(indices.length)}. Povolené velikosti jsou ${allowedSizes}.`);
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

        const groupId = state.nextGroupId;
        state.groups.push({
            id: groupId,
            indices,
            color: GROUP_COLORS[styleIndex % GROUP_COLORS.length],
            literalStates
        });
        state.nextGroupId += 1;
        state.activeGroupId = groupId;
        state.selectedIndices.clear();
        elements.clearSelectionButton.disabled = true;

        renderMap();
        renderGroups();
        updateEquation();

        const redundant = findRedundantGroupNumbers();
        if (redundant.length > 0) {
            showMessage(elements.groupMessage, 'hint', formatRedundantGroupsHint(redundant));
        }
    }

    function renderGroups() {
        elements.groupsList.replaceChildren();
        const variables = core.getVariableNames(state.variableCount);

        state.groups.forEach((group, position) => {
            const item = document.createElement('li');
            item.className = 'group-item';
            item.dataset.groupId = String(group.id);
            item.style.setProperty('--group-color', group.color);
            item.classList.toggle('is-editing', group.id === state.activeGroupId);
            if (group.id === state.activeGroupId) item.setAttribute('aria-current', 'true');

            item.addEventListener('pointerenter', () => setActiveGroup(group.id));
            item.addEventListener('pointerleave', () => scheduleGroupDeactivation(group.id));
            item.addEventListener('focusin', () => setActiveGroup(group.id));
            item.addEventListener('focusout', () => scheduleGroupDeactivation(group.id));

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
                    button.dataset.groupId = String(group.id);
                    button.dataset.variable = variable;
                    renderLiteralButtonContent(button, variable, literalState);
                    button.setAttribute('aria-label', literalButtonAriaLabel(position + 1, variable, literalState));
                    button.title = `Kliknutím měníš ${variable}? → ${variable} → negované ${variable}`;
                    button.addEventListener('click', () => toggleLiteral(group.id, variable));
                    controls.appendChild(button);
                }
                item.appendChild(controls);
            }

            elements.groupsList.appendChild(item);
        });

        refreshActiveGroupVisuals();
    }

    function setActiveGroup(groupId) {
        const nextGroupId = groupId !== null && state.groups.some(group => group.id === groupId)
            ? groupId
            : null;

        if (state.activeGroupId === nextGroupId) {
            refreshActiveGroupVisuals();
            return;
        }

        state.activeGroupId = nextGroupId;
        refreshActiveGroupVisuals();
        updateEquation();
    }

    function refreshActiveGroupVisuals() {
        const activeGroup = state.groups.find(group => group.id === state.activeGroupId) ?? null;
        const activeIndices = activeGroup ? new Set(activeGroup.indices) : null;

        for (const cell of getMapCells()) {
            const active = Boolean(activeIndices?.has(Number(cell.dataset.index)));
            cell.classList.toggle('group-edit-active', active);
            if (active) cell.style.setProperty('--active-group-color', activeGroup.color);
            else cell.style.removeProperty('--active-group-color');
        }

        for (const shape of elements.mapContainer.querySelectorAll('.group-shape[data-group-id]')) {
            const active = Number(shape.dataset.groupId) === state.activeGroupId;
            shape.classList.toggle('is-active', active);
            shape.classList.toggle('is-muted', state.activeGroupId !== null && !active);
        }

        for (const badge of elements.mapContainer.querySelectorAll('.group-badge[data-group-id]')) {
            const active = Number(badge.dataset.groupId) === state.activeGroupId;
            badge.classList.toggle('is-active', active);
            badge.classList.toggle('is-muted', state.activeGroupId !== null && !active);
        }

        for (const summary of elements.mapContainer.querySelectorAll('.group-badge-summary')) {
            const active = summary.parentElement.querySelector('.group-badge.is-active');
            summary.textContent = active ? `+${Number(summary.dataset.count) - 1}` : `×${summary.dataset.count}`;
        }

        for (const item of elements.groupsList.querySelectorAll('.group-item[data-group-id]')) {
            const active = Number(item.dataset.groupId) === state.activeGroupId;
            item.classList.toggle('is-editing', active);
            if (active) item.setAttribute('aria-current', 'true');
            else item.removeAttribute('aria-current');
        }
    }

    function scheduleGroupDeactivation(groupId) {
        window.requestAnimationFrame(() => {
            const currentItem = elements.groupsList.querySelector(`.group-item[data-group-id="${groupId}"]`);
            const stillEditing = currentItem
                && (currentItem.matches(':hover') || currentItem.contains(document.activeElement));
            if (!stillEditing && state.activeGroupId === groupId) setActiveGroup(null);
        });
    }

    function renderLiteralButtonContent(button, variable, literalState) {
        button.replaceChildren();
        if (literalState === LiteralState.OMITTED) {
            const placeholder = document.createElement('span');
            placeholder.className = 'literal-placeholder';
            const variableLabel = document.createElement('span');
            variableLabel.className = 'literal-placeholder-symbol';
            variableLabel.textContent = variable;
            const questionMark = document.createElement('span');
            questionMark.className = 'literal-placeholder-question';
            questionMark.textContent = '?';
            placeholder.append(variableLabel, questionMark);
            placeholder.setAttribute('aria-hidden', 'true');
            button.appendChild(placeholder);
            return;
        }
        button.appendChild(createLiteralSymbol(
            variable,
            literalState === LiteralState.NEGATED
        ));
    }

    function createLiteralSymbol(variable, negated) {
        const literal = document.createElement('span');
        literal.className = negated
            ? 'literal-symbol is-negated'
            : 'literal-symbol';
        literal.textContent = presentation.literalText(variable, negated);
        literal.setAttribute('aria-label', negated ? `negované ${variable}` : variable);
        return literal;
    }

    function literalButtonAriaLabel(groupNumber, variable, literalState) {
        const stateLabel = literalState === LiteralState.POSITIVE
            ? 'přímá forma'
            : literalState === LiteralState.NEGATED
                ? 'negovaná forma'
                : 'nezahrnuta ve výrazu';
        return `Skupina ${groupNumber}, proměnná ${variable}: ${stateLabel}. Změnit stav.`;
    }

    function toggleLiteral(groupId, variable) {
        markSolverDirty();
        const group = state.groups.find(candidate => candidate.id === groupId);
        if (!group) return;

        setActiveGroup(groupId);
        const order = [LiteralState.OMITTED, LiteralState.POSITIVE, LiteralState.NEGATED];
        const current = order.indexOf(group.literalStates[variable]);
        group.literalStates[variable] = order[(current + 1) % order.length];
        renderGroups();
        updateEquation();

        const editedButton = elements.groupsList.querySelector(
            `.group-item[data-group-id="${groupId}"] .literal-button[data-variable="${variable}"]`
        );
        editedButton?.focus({ preventScroll: true });
    }

    function removeGroup(groupId) {
        const oldPosition = state.groups.findIndex(group => group.id === groupId);
        const restoreFocus = elements.groupsList.contains(document.activeElement);
        markSolverDirty();
        state.groups = state.groups.filter(group => group.id !== groupId);
        if (state.activeGroupId === groupId) state.activeGroupId = null;
        renderMap();
        renderGroups();
        updateEquation();
        if (restoreFocus) {
            const next = state.groups[Math.min(oldPosition, state.groups.length - 1)];
            const target = next
                ? elements.groupsList.querySelector(`[data-group-id="${next.id}"] .remove-group-button`)
                : elements.createGroupButton;
            target?.focus({ preventScroll: true });
        }
    }

    function updateEquation() {
        const output = elements.finalEquation;
        output.replaceChildren();

        if (state.phase === Phase.TABLE || state.phase === Phase.MAP) {
            setEquationText('Y = …');
            return;
        }

        if (state.taskIndices.length === 0 && state.groups.length === 0) {
            setEquationText(`Y = ${state.solveMode === 'minterm' ? '0' : '1'}`);
            return;
        }

        if (state.groups.length === 0) {
            setEquationText('Y = …');
            return;
        }

        output.appendChild(document.createTextNode('Y = '));
        const joiner = state.solveMode === 'minterm' ? ' + ' : ' · ';
        const accessibleTerms = [];

        state.groups.forEach((group, position) => {
            if (position > 0) output.appendChild(document.createTextNode(joiner));
            const model = getUserGroupTermModel(group);
            const term = document.createElement('span');
            term.className = 'equation-term';
            term.style.setProperty('--group-color', group.color);
            term.classList.toggle('is-editing', group.id === state.activeGroupId);
            appendUserGroupTerm(term, model);
            output.appendChild(term);
            accessibleTerms.push(formatAccessibleGroupTerm(model));
            term.dataset.plainText = presentation.termText(model, state.solveMode);
        });

        output.dataset.plainText = 'Y = ' + state.groups
            .map(group => presentation.termText(getUserGroupTermModel(group), state.solveMode)).join(joiner);
        const accessibleJoiner = state.solveMode === 'minterm' ? ' plus ' : ' krát ';
        output.setAttribute('aria-label', `Y se rovná ${accessibleTerms.join(accessibleJoiner)}`);
    }

    function setEquationText(text) {
        elements.finalEquation.textContent = text;
        elements.finalEquation.dataset.plainText = text;
        elements.finalEquation.setAttribute('aria-label', text);
    }

    function getUserGroupTermModel(group) {
        const logic = core.getGroupLogic(group.indices, state.variableCount);
        if (logic.involvedVars.length === 0) {
            return {
                constant: state.solveMode === 'minterm' ? '1' : '0',
                literals: [],
                complete: true
            };
        }

        const selectedVariables = core.getVariableNames(state.variableCount)
            .filter(variable => group.literalStates[variable] !== LiteralState.OMITTED);
        const expectedSet = new Set(logic.involvedVars);
        const completeVariableSet = selectedVariables.length === expectedSet.size
            && selectedVariables.every(variable => expectedSet.has(variable));

        return {
            constant: null,
            literals: selectedVariables.map(variable => ({
                variable,
                negated: group.literalStates[variable] === LiteralState.NEGATED
            })),
            complete: completeVariableSet
        };
    }

    function appendUserGroupTerm(parent, model) {
        if (model.constant !== null) {
            parent.appendChild(document.createTextNode(model.constant));
            return;
        }

        if (state.solveMode === 'minterm') {
            if (model.literals.length === 0) {
                parent.appendChild(document.createTextNode('[?]'));
                return;
            }
            model.literals.forEach((literal, position) => {
                if (position > 0) parent.appendChild(document.createTextNode('·'));
                parent.appendChild(createLiteralSymbol(literal.variable, literal.negated));
            });
            if (!model.complete) parent.appendChild(document.createTextNode('·?'));
            return;
        }

        parent.appendChild(document.createTextNode('('));
        if (model.literals.length === 0) {
            parent.appendChild(document.createTextNode('?'));
        } else {
            model.literals.forEach((literal, position) => {
                if (position > 0) parent.appendChild(document.createTextNode(' + '));
                parent.appendChild(createLiteralSymbol(literal.variable, literal.negated));
            });
            if (!model.complete) parent.appendChild(document.createTextNode(' + ?'));
        }
        parent.appendChild(document.createTextNode(')'));
    }

    function formatAccessibleGroupTerm(model) {
        if (model.constant !== null) return model.constant;
        if (model.literals.length === 0) return 'nevyplněný člen';
        const operator = state.solveMode === 'minterm' ? ' krát ' : ' plus ';
        const literals = model.literals.map(literal => (
            literal.negated ? `negované ${literal.variable}` : literal.variable
        ));
        const suffix = model.complete ? '' : ' a nevyplněná část';
        return `${literals.join(operator)}${suffix}`;
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
            showMessage(elements.finalMessage, 'error', `Skupiny zasahují i do necílových buněk: ${formatIndices(coverage.outside)}.`);
            return;
        }
        if (coverage.missing.length > 0) {
            const message = coverage.missing.length === 1
                ? `Není pokryta cílová buňka s indexem ${coverage.missing[0]}.`
                : `Nejsou pokryty cílové buňky s indexy ${formatIndices(coverage.missing)}.`;
            showMessage(elements.finalMessage, 'error', message);
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
            const message = redundant.length === 1
                ? `Nadbytečná skupina: ${redundant[0]}. Její buňky už pokrývají ostatní skupiny.`
                : `Nadbytečné skupiny: ${redundant.join(', ')}. Jejich buňky už pokrývají ostatní skupiny.`;
            showMessage(elements.finalMessage, 'error', message);
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
                ? `používá o ${formatCount(termDifference, 'člen', 'členy', 'členů')} více`
                : `používá více literálů (${userCost.literals} místo ${optimalCost.literals})`;
            showMessage(
                elements.finalMessage,
                'error',
                `Výraz je logicky správný, ale není minimální: ${reason}. Tvé řešení má ${formatCost(userCost)}, zatímco minimální řešení má ${formatCost(optimalCost)}.`
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
                showMessage(elements.hintMessage, 'hint', `Aktuální výběr má ${formatCellCount(selection.length)}. Doplň nebo odeber buňky tak, aby velikost byla mocninou dvou.`);
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
                const anchor = candidate.indices.find(index => missingSet.has(index));
                highlightIndices(candidate.indices);
                showMessage(
                    elements.hintMessage,
                    'hint',
                    `Začni nepokrytým indexem ${anchor}. Jedna vhodná maximální skupina má ${formatCellCount(candidate.cellCount)}: ${formatIndices(candidate.indices)}.`
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
                `Pokrytí je úplné, ale minimální řešení má ${formatCost(optimalCost)}. Zkus přeuspořádat skupiny; zvýrazněná oblast patří do jednoho optimálního řešení.`
            );
            return;
        }

        showMessage(elements.hintMessage, 'hint', 'Pokrytí i volba proměnných vypadají správně. Proveď závěrečnou kontrolu.');
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

    function formatCount(count, singular, few, many) {
        const word = count === 1 ? singular : count >= 2 && count <= 4 ? few : many;
        return `${count} ${word}`;
    }

    function formatCellCount(count) {
        return formatCount(count, 'buňku', 'buňky', 'buněk');
    }

    function formatRedundantGroupsHint(groupNumbers) {
        if (groupNumbers.length === 1) {
            return `Skupina ${groupNumbers[0]} je pravděpodobně nadbytečná: všechny její buňky už pokrývají ostatní skupiny. Před závěrečnou kontrolou ji zkus odstranit.`;
        }
        return `Skupiny ${groupNumbers.join(', ')} jsou pravděpodobně nadbytečné: všechny jejich buňky už pokrývají ostatní skupiny. Před závěrečnou kontrolou je zkus odstranit.`;
    }

    function formatCost(cost) {
        return `${formatCount(cost.terms, 'člen', 'členy', 'členů')}, ${formatCount(cost.literals, 'literál', 'literály', 'literálů')}`;
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
