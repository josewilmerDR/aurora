document.addEventListener('DOMContentLoaded', () => {
    const addActivityBtn = document.getElementById('add-activity-btn');
    const activitiesContainer = document.getElementById('activities-container');
    const form = document.getElementById('package-form');
    let activityCounter = 0;

    const createActivityRow = () => {
        activityCounter++;
        const row = document.createElement('div');
        row.classList.add('activity-row');
        row.setAttribute('data-id', activityCounter);
        row.innerHTML = `
            <div class="form-group day-input">
                <label for="day-${activityCounter}">Día</label>
                <input type="number" id="day-${activityCounter}" name="day" placeholder="Ej: 1" required>
            </div>
            <div class="form-group name-input">
                <label for="activity-name-${activityCounter}">Nombre de la Actividad</label>
                <input type="text" id="activity-name-${activityCounter}" name="activityName" placeholder="Ej: Limpieza de Lote" required>
            </div>
            <div class="form-group responsible-input">
                <label for="responsible-${activityCounter}">Responsable</label>
                <input type="text" id="responsible-${activityCounter}" name="responsible" placeholder="Ej: Juan" required>
            </div>
            <button type="button" class="btn btn-danger remove-activity-btn">Eliminar</button>
        `;
        activitiesContainer.appendChild(row);
    };

    createActivityRow();
    addActivityBtn.addEventListener('click', createActivityRow);

    activitiesContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-activity-btn')) {
            e.target.closest('.activity-row').remove();
        }
    });

    // --- LÓGICA DE ENVÍO MODIFICADA PARA MEJOR DEBUGGING ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Guardando...';

        const packageData = {
            packageName: document.getElementById('package-name').value,
            harvestType: document.getElementById('harvest-type').value,
            cropStage: document.getElementById('crop-stage').value,
            activities: []
        };

        const activityRows = activitiesContainer.querySelectorAll('.activity-row');
        activityRows.forEach(row => {
            packageData.activities.push({
                day: row.querySelector('input[name="day"]').value,
                name: row.querySelector('input[name="activityName"]').value,
                responsible: row.querySelector('input[name="responsible"]').value
            });
        });

        try {
            const response = await fetch('/api/packages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(packageData),
            });

            const result = await response.json(); // Leer el cuerpo de la respuesta, sea de éxito o de error.

            if (response.ok) {
                alert('¡Éxito! ' + result.message);
                form.reset();
                activitiesContainer.innerHTML = '';
                createActivityRow();
            } else {
                // ¡AQUÍ ESTÁ LA MAGIA!
                // Si la respuesta es un error, lo mostramos en la consola y en una alerta más detallada.
                console.error("Error devuelto por el servidor:", result);
                const detailedError = result.error || result.message;
                alert(`Error al guardar: ${detailedError}\n\nRevisa la consola del navegador (F12) para ver el objeto de error completo.`);
            }

        } catch (error) {
            // Este bloque ahora atrapará errores de red u otros problemas ANTES de obtener una respuesta del servidor.
            console.error('Error de red o al procesar el fetch:', error);
            alert('Error de conexión. No se pudo contactar al servidor. Revisa la consola del navegador (F12).');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Guardar Paquete Técnico';
        }
    });
});