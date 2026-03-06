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
            
            // Handle high-stakes time limit
            if (blockData.time_limit_ms) {
               // Optional: You could start a visual countdown here
            }

            renderQuestion();

        } catch (error) {
            console.error("Hiba a kérdések betöltésekor:", error);
            alert("Hiba a teszt betöltésekor. Ellenőrizze a data mappát!");
        }
    }

    // --- 6. RENDER QUESTION & TIMING ---
    function renderQuestion() {
        if (currentQuestionIndex >= activeQuestions.length) {
            // Block is finished
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

        // Shuffle options so the correct answer isn't always in the same place
        let displayOptions = [...q.options];
        shuffleArray(displayOptions);

        displayOptions.forEach(opt => {
            const btn = $(`<button class="btn btn-outline-primary btn-lg text-start answer-btn">${opt}</button>`);
            btn.on('click', function() {
                handleAnswer(opt, q);
            });
            $options.append(btn);
        });

        // Start High-Precision Timer
        questionStartTime = performance.now();
    }

    // --- 7. HANDLE ANSWERS & LOGGING ---
    function handleAnswer(selectedOption, questionObj) {
        const endTime = performance.now();
        const reactionTimeMs = Math.round(endTime - questionStartTime);

        // 1. Get the active rule's field name (e.g., 'correct_answer', 'left_hand_rule', etc.)
        const expectedField = currentBlockData.correct_answer_field;

        // 2. Extract the original, baseline KRESZ answer
        const originalCorrect = questionObj['correct_answer'];

        // 3. Extract what they SHOULD answer in this specific block
        const expectedAnswer = questionObj[expectedField] || originalCorrect;
        
        const isCorrect = (selectedOption === expectedAnswer);

        // 4. DYNAMIC PERSEVERATION CHECK
        // If the block is NOT using 'correct_answer', AND they answered incorrectly, 
        // BUT their answer matches the old baseline rule -> They fell back to habit!
        let isPerseveration = false;
        if (expectedField !== 'correct_answer' && !isCorrect && selectedOption === originalCorrect) {
            isPerseveration = true;
        }

        // 5. Save comprehensive Log Data
        experimentData.logs.push({
            block_name: currentBlockData.name,
            question_text: questionObj.question,
            active_rule_name: expectedField,              // e.g., 'left_hand_rule'
            user_answer: selectedOption,
            expected_answer: expectedAnswer,              // What they should have clicked
            original_baseline_answer: originalCorrect,    // The old habit
            is_correct: isCorrect,
            is_perseveration_error: isPerseveration,      // TRUE if they used the old KRESZ rule
            reaction_time_ms: reactionTimeMs,
            timestamp: new Date().toISOString()
        });

        // Handle immediate feedback if enabled for this block
        if (currentBlockData.has_feedback) {
            if (isCorrect) {
                alert("Helyes válasz!");
            } else {
                alert(`Helytelen. A helyes válasz a jelenlegi szabályok szerint: ${expectedAnswer}`);
            }
        }

        // Move to next question
        currentQuestionIndex++;
        renderQuestion();
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
    function downloadData() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(experimentData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        
        // Format filename: anon_nev-timestamp.json
        const safeName = (experimentData.user.anonim_nev || "user").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const dateStr = new Date().toISOString().slice(0,10);
        
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", `kresz_kutatas_${safeName}_${dateStr}.json`);
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        // --- UPDATED UI LOGIC ---
        $('#message-title').text("Sikeres letöltés!");
        $('#message-content').text("Köszönjük az együttműködést, az ablakot most már bezárhatja. Ha a letöltés nem indult el, vagy elveszett a fájl, kattintson az alábbi gombra.");
        
        // Instead of hiding the button, we keep it visible and change the text.
        // The click event is already bound to this function, so clicking it will just run this again!
        $('#message-btn').text("Letöltés újra").removeClass('hidden');
    }

});