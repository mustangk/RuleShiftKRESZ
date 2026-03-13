$(document).ready(function() {

    // --- GLOBAL STATE ---
    const experimentData = {
        user: {},
        logs: []
    };
    let experimentSequence = [];
    let currentStepIndex = 0;
    
    let currentBlockData = null;
    let activeQuestions = [];
    let currentQuestionIndex = 0;
    let questionStartTime = 0;
    let blockTimer = null;
    let questionTimeout = null;
    let visualTimerInterval = null;

    // --- 1. INITIALIZATION: LOAD FORM ---
    $.getJSON('form_params.json', function(formParams) {
        const $container = $('#dynamic-form-fields');
        
        formParams.forEach(field => {
            let html = `<div class="mb-3"><label for="${field.id}" class="form-label">${field.label}</label>`;
            
            if (field.type === 'text' || field.type === 'number') {
                html += `<input type="${field.type}" class="form-control" id="${field.id}" name="${field.id}" 
                            ${field.required ? 'required' : ''} 
                            ${field.min !== undefined ? `min="${field.min}"` : ''} 
                            ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}
                            ${field.default !== undefined ? `value="${field.default}"` : ''}>`;
            } else if (field.type === 'select') {
                html += `<select class="form-select" id="${field.id}" name="${field.id}" ${field.required ? 'required' : ''}>
                            <option value="" selected disabled>Válasszon...</option>`;
                field.options.forEach(opt => {
                    html += `<option value="${opt}">${opt}</option>`;
                });
                html += `</select>`;
            }
            
            if (field.help_text) {
                html += `<div class="form-text">${field.help_text}</div>`;
            }
            html += `</div>`;
            $container.append(html);
        });
    }).fail(function() {
        alert("Hiba történt a form_params.json betöltésekor!");
    });

    // --- 2. FORM SUBMISSION ---
    $('#demographics-form').on('submit', function(e) {
        e.preventDefault();
        
        // Gather all data from the form
        const formData = new FormData(this);
        formData.forEach((value, key) => {
            experimentData.user[key] = value;
        });

        // Add a global start timestamp
        experimentData.user.experiment_start_time = new Date().toISOString();

        // Transition to experiment
        $('#form-container').addClass('hidden');
        loadExperimentParams();
    });

    // --- 3. LOAD PARAMS & SEQUENCE ENGINE ---
    function loadExperimentParams() {
        $.getJSON('params.json', function(data) {
            experimentSequence = data.experiment_sequence;
            executeStep();
        }).fail(function() {
            alert("Hiba: A params.json nem található!");
        });
    }

    function executeStep() {
        if (currentStepIndex >= experimentSequence.length) {
            return; // Experiment is over
        }

        const step = experimentSequence[currentStepIndex];

        if (step.type === 'message') {
            showMessage(step);
        } else if (step.type === 'block') {
            startBlock(step);
        }
    }

    // --- 4. MESSAGE SCREEN HANDLING ---
    function showMessage(stepData) {
        $('#test-container').addClass('hidden');
        $('#message-container').removeClass('hidden');
        
        $('#message-title').text(stepData.title);
        $('#message-content').html(stepData.content); // Use HTML in case of line breaks
        
        const $btn = $('#message-btn');
        $btn.text(stepData.button_text).off('click');

        $btn.on('click', function() {
            if (stepData.action === 'download_logs') {
                downloadData();
            } else {
                currentStepIndex++;
                executeStep();
            }
        });
    }

    // --- 5. BLOCK HANDLING & QUESTION FETCHING ---
    async function startBlock(blockData) {
        currentBlockData = blockData;
        $('#message-container').addClass('hidden');
        
        // Show loading state
        $('#block-name-display').text("Töltés...");
        $('#test-container').removeClass('hidden');
        $('#options-container').empty();
        $('#question-text').text("Kérdések betöltése...");
        $('#question-image').addClass('hidden');

        try {
            // Fetch all files simultaneously
            let fetchPromises = blockData.sources.map(source => 
                fetch(source.file).then(res => res.json()).then(data => {
                    shuffleArray(data); // Shuffle the bank
                    return data.slice(0, source.count); // Take only what we need
                })
            );

            // Wait for all fetches to finish and merge the arrays
            let arraysOfQuestions = await Promise.all(fetchPromises);
            activeQuestions = [].concat(...arraysOfQuestions);
            
            // Final shuffle of the mixed questions
            shuffleArray(activeQuestions);

            // Reset block state
            currentQuestionIndex = 0;
            $('#block-name-display').text(blockData.name);

            renderQuestion();

        } catch (error) {
            console.error("Hiba a kérdések betöltésekor:", error);
            alert("Hiba a teszt betöltésekor. Ellenőrizze a data mappát!");
        }
    }

// --- 6. RENDER QUESTION & TIMING ---
    function renderQuestion() {
        // Clear any leftover timers
        if (questionTimeout) {
            clearTimeout(questionTimeout);
            questionTimeout = null;
        }
        if (visualTimerInterval) {
            clearInterval(visualTimerInterval);
            visualTimerInterval = null;
        }

        if (currentQuestionIndex >= activeQuestions.length) {
            currentStepIndex++;
            executeStep();
            return;
        }

        const q = activeQuestions[currentQuestionIndex];
        
        $('#question-counter').text(`Kérdés: ${currentQuestionIndex + 1} / ${activeQuestions.length}`);
        $('#question-text').text(q.question);
        
        if (q.image) {
            $('#question-image').attr('src', q.image).removeClass('hidden');
        } else {
            $('#question-image').addClass('hidden');
        }

        const $options = $('#options-container');
        $options.empty();

        let displayOptions = [...q.options];
        shuffleArray(displayOptions);

        displayOptions.forEach(opt => {
            const btn = $(`<button class="btn btn-outline-primary btn-lg text-start answer-btn">${opt}</button>`);
            btn.on('click', function() {
                handleAnswer(opt, q);
            });
            $options.append(btn);
        });

        questionStartTime = performance.now();

        // --- NEW: Visual Countdown Logic ---
        const $timerContainer = $('#timer-container');
        const $timerBar = $('#timer-bar');

        if (currentBlockData.time_limit_ms) {
            const totalTime = currentBlockData.time_limit_ms;
            
            // Show and reset the bar
            $timerContainer.removeClass('hidden');
            $timerBar.css('width', '100%').removeClass('bg-warning bg-danger').addClass('bg-success');

            // Update the bar every 30 milliseconds for smooth animation
            visualTimerInterval = setInterval(() => {
                const elapsed = performance.now() - questionStartTime;
                const remaining = Math.max(0, totalTime - elapsed);
                const percentage = (remaining / totalTime) * 100;

                $timerBar.css('width', `${percentage}%`);

                // Change color as time runs out
                if (percentage < 50 && percentage >= 20) {
                    $timerBar.removeClass('bg-success').addClass('bg-warning');
                } else if (percentage < 20) {
                    $timerBar.removeClass('bg-warning').addClass('bg-danger');
                }

                if (remaining <= 0) {
                    clearInterval(visualTimerInterval);
                }
            }, 30);

            // The actual logic timeout
            questionTimeout = setTimeout(function() {
                handleAnswer("", q);
            }, totalTime);

        } else {
            // Hide the timer if this block has no time limit
            $timerContainer.addClass('hidden');
        }
    }

    // --- 7. HANDLE ANSWERS & LOGGING ---
    function handleAnswer(selectedOption, questionObj) {
        if (questionTimeout) {
            clearTimeout(questionTimeout);
            questionTimeout = null;
        }

        const endTime = performance.now();
        const reactionTimeMs = Math.round(endTime - questionStartTime);

        const expectedField = currentBlockData.correct_answer_field;
        const originalCorrect = questionObj['correct_answer'];
        const expectedAnswer = questionObj[expectedField] || originalCorrect;
        
        const isCorrect = (selectedOption === expectedAnswer);

        let isPerseveration = false;
        if (expectedField !== 'correct_answer' && !isCorrect && selectedOption === originalCorrect) {
            isPerseveration = true;
        }

        experimentData.logs.push({
            block_name: currentBlockData.name,
            question_text: questionObj.question,
            active_rule_name: expectedField,
            user_answer: selectedOption,
            expected_answer: expectedAnswer,
            original_baseline_answer: originalCorrect,
            is_correct: isCorrect,
            is_perseveration_error: isPerseveration,
            reaction_time_ms: reactionTimeMs,
            timestamp: new Date().toISOString()
        });

        //Modal response
        let showModal = false;
        const $wrapper = $('#modal-content-wrapper');
        const $btn = $('#modal-next-btn');

        // Reset classes
        $wrapper.removeClass('alert-success alert-danger alert-warning');
        $btn.removeClass('btn-success btn-danger btn-warning').text('Tovább'); 

        if (selectedOption === "") {
            showModal = true;
            $wrapper.addClass('alert-warning');
            $btn.addClass('btn-warning');
            $('#modal-icon').text('⏳');
            $('#modal-title').text('Lejárt az idő!');
            $('#modal-text').text('Sajnos nem érkezett válasz a megadott időn belül.');
        } else if (currentBlockData.has_feedback) {
            showModal = true;
            if (isCorrect) {
                $wrapper.addClass('alert-success');
                $btn.addClass('btn-success');
                $('#modal-icon').text('✔️');
                $('#modal-title').text('Helyes válasz!');
                $('#modal-text').text('Gratulálunk, jól döntöttél.');
            } else {
                $wrapper.addClass('alert-danger');
                $btn.addClass('btn-danger');
                $('#modal-icon').text('❌');
                $('#modal-title').text('Helytelen!');
                $('#modal-text').html(`A helyes válasz a jelenlegi szabályok szerint:<br><strong>${expectedAnswer}</strong>`);
            }
        }

        if (showModal) {
            // Force focus to button when modal opens for accessibility and mobile clicks
            $('#feedbackModal').off('shown.bs.modal').on('shown.bs.modal', function () {
                $btn.focus();
            });

            $('#feedbackModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
                currentQuestionIndex++;
                renderQuestion();
            });

            $('#feedbackModal').modal('show');
        } else {
            currentQuestionIndex++;
            renderQuestion();
        }
    }

    // --- 8. UTILITIES ---
    
    // Fisher-Yates Shuffle
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

// Export Data as JSON file
// Export Data as JSON file
    function downloadData() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(experimentData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        
        const safeName = (experimentData.user.anonim_nev || "user").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const dateStr = new Date().toISOString().slice(0,10);
        
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", `kresz_kutatas_${safeName}_${dateStr}.json`);
        document.body.appendChild(downloadAnchorNode); 
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        // --- NEW TABLE GENERATION LOGIC ---
        $('#message-title').text("Sikeres letöltés!");
        
        let tableHtml = `
            <p class="mb-4">Köszönjük az együttműködést! Alább láthatja az eredményeit összefoglalva:</p>
            <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                <table class="table table-sm table-striped table-hover border">
                    <thead class="table-dark sticky-top">
                        <tr>
                            <th>Blokk</th>
                            <th>Válasz</th>
                            <th>Helyes?</th>
                            <th>Reakcióidő</th>
                        </tr>
                    </thead>
                    <tbody>`;

        experimentData.logs.forEach(log => {
            const statusClass = log.is_correct ? 'text-success' : 'text-danger';
            const statusIcon = log.is_correct ? '✔️' : '❌';
            
            tableHtml += `
                <tr>
                    <td class="small">${log.block_name}</td>
                    <td class="small">${log.user_answer || "Nincs"}</td>
                    <td class="${statusClass} fw-bold">${statusIcon}</td>
                    <td>${log.reaction_time_ms} ms</td>
                </tr>`;
        });

        tableHtml += `
                    </tbody>
                </table>
            </div>
            <p class="mt-4 text-muted small">Ha a letöltés nem indult el, kattintson az alábbi gombra.</p>`;
        
        $('#message-content').html(tableHtml);
        $('#message-btn').text("Letöltés újra").removeClass('hidden');
    }

});