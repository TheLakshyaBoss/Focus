import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  StatusBar, 
  Platform, 
  Dimensions 
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { Play, Square } from 'lucide-react-native';

const { width } = Dimensions.get('window');
const TIMER_SIZE = width * 0.75;

// Configure how notifications are handled when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  // Configuration: 0 to 60 minutes in 5-minute intervals
  const intervals = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const [selectedIdx, setSelectedIdx] = useState(4); // Default to 25 mins
  
  const [secondsLeft, setSecondsLeft] = useState(intervals[selectedIdx] * 60);
  const [isActive, setIsActive] = useState(false);
  const timerRef = useRef(null);

  // Request notification permissions on mount
  useEffect(() => {
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    })();
  }, []);

  // Synchronize timer duration when the user changes the setting (while inactive)
  useEffect(() => {
    if (!isActive) {
      setSecondsLeft(intervals[selectedIdx] * 60);
    }
  }, [selectedIdx, isActive]);

  // Main timer countdown logic
  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setIsActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }

    return () => clearInterval(timerRef.current);
  }, [isActive]);

  // Handle Play / Pause / Stop
  const toggleTimer = async () => {
    if (isActive) {
      // Pausing: Cancel scheduled notification alerts
      setIsActive(false);
      await Notifications.cancelAllScheduledNotificationsAsync();
    } else {
      // Starting: Schedule a notification for when the timer hits zero
      setIsActive(true);
      if (secondsLeft > 0) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Focus Session Complete!",
            body: "Great job staying focused. Take a short break!",
            sound: true,
          },
          trigger: { seconds: secondsLeft },
        });
      }
    }
  };

  const resetTimer = async () => {
    setIsActive(false);
    await Notifications.cancelAllScheduledNotificationsAsync();
    setSecondsLeft(intervals[selectedIdx] * 60);
  };

  // Adjust time via tap intervals (simulating a clean step-dial within the circle)
  const changeDuration = () => {
    if (isActive) return; // Lock adjustment while running
    const nextIdx = (selectedIdx + 1) % intervals.length;
    setSelectedIdx(nextIdx);
  };

  // Helper formatting functions
  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDuration = intervals[selectedIdx] * 60;
  const progressPercentage = totalDuration > 0 ? (secondsLeft / totalDuration) : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0B0F" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FOCUS</Text>
      </View>

      {/* Main Dial Interface */}
      <View style={styles.timerContainer}>
        <TouchableOpacity 
          activeOpacity={isActive ? 0.9 : 0.7}
          onPress={changeDuration}
          style={[
            styles.dialButton,
            { borderColor: isActive ? '#6366F1' : '#27272A' }
          ]}
        >
          {/* Visual Progress Highlight Track */}
          <View style={[styles.progressTrack, { opacity: isActive ? 0.05 : 0 }]} />
          
          <Text style={styles.timerText}>{formatTime(secondsLeft)}</Text>
          {!isActive && (
            <Text style={styles.hintText}>Tap to change duration</Text>
          )}
          {isActive && (
            <Text style={styles.runningText}>{intervals[selectedIdx]}m Target</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Controls Footer */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={toggleTimer}>
          <Play size={24} color={isActive ? '#EF4444' : '#10B981'} fill={isActive ? '#EF4444' : '#10B981'} />
          <Text style={styles.actionText}>{isActive ? 'Pause' : 'Start'}</Text>
        </TouchableOpacity>

        {isActive && (
          <TouchableOpacity style={[styles.actionButton, styles.stopButton]} onPress={resetTimer}>
            <Square size={20} color="#9CA3AF" fill="#9CA3AF" />
            <Text style={[styles.actionText, { color: '#9CA3AF' }]}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0F', // Deep minimalist dark background
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: {
    marginTop: Platform.OS === 'ios' ? 20 : 40,
    width: '100%',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F4F4F5',
    letterSpacing: 4,
  },
  timerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialButton: {
    width: TIMER_SIZE,
    height: TIMER_SIZE,
    borderRadius: TIMER_SIZE / 2,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121218',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  progressTrack: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#6366F1',
  },
  timerText: {
    fontSize: 54,
    fontWeight: '300',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  hintText: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  runningText: {
    fontSize: 12,
    color: '#6366F1',
    marginTop: 8,
    fontWeight: '600',
    letterSpacing: 1,
  },
  controlsContainer: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 30,
    gap: 8,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  stopButton: {
    borderColor: '#27272A',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});