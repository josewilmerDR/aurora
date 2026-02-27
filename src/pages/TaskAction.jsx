import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const TaskAction = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    const fetchTask = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) {
          throw new Error('La tarea no fue encontrada o no tienes acceso a ella.');
        }
        const data = await response.json();
        setTask(data);
        // Si la tarea ya está completada, lo reflejamos en el estado
        if (data.status === 'completed_by_user') {
            setIsCompleted(true);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId]);

  const handleCompleteTask = async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed_by_user' }),
      });

      if (!response.ok) {
        throw new Error('No se pudo actualizar la tarea.');
      }
      setIsCompleted(true);
      // Opcional: Redirigir al dashboard después de un momento
      // setTimeout(() => navigate('/'), 3000);

    } catch (err) {
      setError(err.message);
    }
  };
  
  // Renderiza un estado de carga
  if (loading) {
    return <div className="container text-center p-8">Cargando detalles de la tarea...</div>;
  }

  // Renderiza un estado de error
  if (error) {
    return <div className="container text-center p-8 text-red-500">Error: {error}</div>;
  }

  // Renderiza el mensaje de éxito si la tarea se completó
  if (isCompleted) {
    return (
      <div className="container max-w-2xl mx-auto p-8 text-center bg-green-100 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-green-800 mb-4">¡Tarea Completada!</h1>
        <p className="text-lg text-gray-700">Has marcado la actividad <strong>\"{task.activityName}\"</strong> como hecha. ¡Buen trabajo!</p>
        <button onClick={() => navigate('/')} className="mt-6 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
          Volver al Panel de Control
        </button>
      </div>
    );
  }

  // Renderiza la vista principal de la tarea
  return (
    <div className="container max-w-2xl mx-auto p-8">
        <div className="bg-white shadow-lg rounded-lg p-6">
            <h1 className="text-3xl font-bold mb-4 border-b pb-2">Gestionar Tarea</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-lg">
                <p><strong>Actividad:</strong></p><p>{task.activityName}</p>
                <p><strong>Lote:</strong></p><p>{task.loteName}</p>
                <p><strong>Responsable:</strong></p><p>{task.responsableName}</p>
                <p><strong>Fecha de Vencimiento:</strong></p><p>{new Date(task.dueDate).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</p>
                <p><strong>Estado Actual:</strong></p><p className="font-semibold text-orange-600">{task.status}</p>
            </div>

            <div className="mt-8 border-t pt-6">
                <h2 className="text-2xl font-semibold mb-4">Acciones</h2>
                <p className="mb-4">¿Ya realizaste esta actividad?</p>
                <button 
                    onClick={handleCompleteTask} 
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded text-xl shadow-md transition-transform transform hover:scale-105"
                >
                    Marcar como Hecha
                </button>

                <div className="mt-6 text-center text-gray-500">
                    <p className="font-semibold">Otras acciones (próximamente):</p>
                    <div className="flex justify-center gap-4 mt-2">
                        <button disabled className="bg-gray-300 text-gray-500 font-bold py-2 px-4 rounded cursor-not-allowed">Reprogramar</button>
                        <button disabled className="bg-gray-300 text-gray-500 font-bold py-2 px-4 rounded cursor-not-allowed">Reasignar</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default TaskAction;
